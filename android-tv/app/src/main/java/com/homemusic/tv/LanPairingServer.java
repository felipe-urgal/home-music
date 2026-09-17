package com.homemusic.tv;

import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class LanPairingServer implements AutoCloseable {
    static final class PairingInfo {
        final String host;
        final int port;
        final String qrText;
        final long expiresAt;

        PairingInfo(String host, int port, String qrText, long expiresAt) {
            this.host = host;
            this.port = port;
            this.qrText = qrText;
            this.expiresAt = expiresAt;
        }
    }

    private static final int MAX_HEADER_LINE = 8 * 1024;
    private static final int MAX_HEADER_COUNT = 64;
    private static final int RATE_WINDOW_MS = 10_000;
    private static final int RATE_MAX_REQUESTS = 120;
    private static final int MAX_RATE_IPS = 128;
    private static final int MAX_RECEIVER_ASSET_BYTES = 8 * 1024 * 1024;

    private final String allowedOrigin;
    private final AssetManager assets;
    private final ThreadPoolExecutor clients = new ThreadPoolExecutor(
        2,
        8,
        30L,
        TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(32),
        new ThreadPoolExecutor.AbortPolicy()
    );
    private final Map<String, ArrayDeque<Long>> requestTimes = new HashMap<>();
    private volatile boolean running;
    private volatile LanPairingSession pairingSession;
    private ServerSocket serverSocket;
    private Thread acceptThread;

    LanPairingServer(String allowedOrigin, AssetManager assets) {
        this.allowedOrigin = allowedOrigin == null ? "" : allowedOrigin;
        this.assets = assets;
        this.pairingSession = new LanPairingSession();
    }

    synchronized void start() throws IOException {
        if (running) return;
        serverSocket = new ServerSocket(0, 8, InetAddress.getByName("0.0.0.0"));
        running = true;
        acceptThread = new Thread(this::acceptLoop, "home-music-lan-pairing");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    synchronized PairingInfo pairingInfo() throws IOException {
        if (!running || serverSocket == null) throw new IOException("Serviço LAN não está ativo.");
        String host = LanAddressResolver.resolve();
        String secret = pairingSession.pairingSecret();
        if (host == null) throw new IOException("Nenhum IPv4 privado disponível na rede local.");
        if (secret == null) throw new IOException("Sessão LAN já foi consumida; regenere o pareamento.");
        String qr = "home-music://tv-lan"
            + "?version=" + LanPairingSession.VERSION
            + "&host=" + host
            + "&port=" + serverSocket.getLocalPort()
            + "&session=" + pairingSession.sessionId()
            + "&secret=" + secret
            + "&expires=" + pairingSession.pairingExpiresAt();
        return new PairingInfo(host, serverSocket.getLocalPort(), qr, pairingSession.pairingExpiresAt());
    }

    synchronized PairingInfo regeneratePairing() throws IOException {
        pairingSession.close();
        pairingSession = new LanPairingSession();
        return pairingInfo();
    }

    synchronized int port() {
        return serverSocket == null ? -1 : serverSocket.getLocalPort();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                try {
                    clients.execute(() -> handle(socket));
                } catch (RejectedExecutionException rejected) {
                    closeSocket(socket);
                }
            } catch (IOException error) {
                if (running) error.printStackTrace();
            }
        }
    }

    private static void closeSocket(Socket socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // best-effort ao rejeitar excesso de conexões
        }
    }

    private void handle(Socket socket) {
        try (Socket client = socket) {
            client.setSoTimeout(10_000);
            String remoteIp = client.getInetAddress().getHostAddress();
            if (!allowRequest(remoteIp)) {
                writeResponse(client, null, Response.json(429, "{\"error\":\"Muitas requisições.\"}"));
                return;
            }
            Request request = readRequest(client.getInputStream());
            if (request == null) return;
            boolean loopback = client.getInetAddress().isLoopbackAddress();
            String origin = request.headers.get("origin");
            if (!originAllowed(origin, loopback)) {
                writeResponse(client, null, Response.json(403, "{\"error\":\"Origin não autorizada.\"}"));
                return;
            }
            if ("OPTIONS".equals(request.method)) {
                writeResponse(client, origin, new Response(204, "application/json; charset=utf-8", new byte[0]));
                return;
            }
            writeResponse(client, origin, route(request, loopback));
        } catch (Exception ignored) {
            // Uma conexão inválida nunca derruba o listener efêmero inteiro.
        }
    }

    private Response route(Request request, boolean loopback) {
        try {
            URI uri = URI.create(request.target);
            String path = uri.getPath();
            Map<String, String> query = query(uri.getRawQuery());
            LanPairingSession session = pairingSession;

            if ("GET".equals(request.method) && "/health".equals(path)) {
                return Response.json(200, new JSONObject()
                    .put("version", LanPairingSession.VERSION)
                    .put("status", session.isClosed() ? "closed" : "ok")
                    .toString());
            }

            if ("GET".equals(request.method) && "/bridge".equals(path)) {
                return receiverAsset("/receiver/bridge.html");
            }

            if ("GET".equals(request.method) && "/bridge.js".equals(path)) {
                return receiverAsset("/receiver/bridge.js");
            }

            if ("GET".equals(request.method) && "/receiver/bootstrap".equals(path)) {
                if (!loopback) return error(403, "Bootstrap do receiver é somente loopback.");
                long expiresAt = session.receiverExpiresAt();
                if (expiresAt <= 0L) return error(410, "Sessão do receiver expirou.");
                return Response.json(200, new JSONObject()
                    .put("version", LanPairingSession.VERSION)
                    .put("sessionId", session.sessionId())
                    .put("sessionToken", session.receiverToken())
                    .put("expiresAt", expiresAt)
                    .put("signalingBase", "http://127.0.0.1:" + port())
                    .toString());
            }

            if ("GET".equals(request.method) && ("/receiver".equals(path) || path.startsWith("/receiver/"))) {
                if (!loopback) return error(403, "Receiver embarcado é somente loopback.");
                return receiverAsset(path);
            }

            if ("GET".equals(request.method) && "/challenge".equals(path)) {
                if (!session.sessionId().equals(query.get("session"))) return error(404, "Sessão não encontrada.");
                LanPairingSession.Challenge challenge = session.createChallenge(query.get("clientNonce"));
                if (challenge == null) return error(410, "Pareamento expirado ou indisponível.");
                return Response.json(200, new JSONObject()
                    .put("sessionId", challenge.sessionId)
                    .put("clientNonce", challenge.clientNonce)
                    .put("tvNonce", challenge.tvNonce)
                    .put("expiresAt", challenge.expiresAt)
                    .toString());
            }

            if ("POST".equals(request.method) && "/join".equals(path)) {
                JSONObject body = request.json();
                if (!session.sessionId().equals(body.optString("sessionId", ""))) return error(404, "Sessão não encontrada.");
                LanPairingSession.JoinResult joined = session.join(
                    body.optString("clientNonce", ""),
                    body.optString("tvNonce", ""),
                    body.optLong("expiresAt", -1L),
                    body.optString("proof", "")
                );
                if (joined == null) return error(401, "Prova de pareamento inválida ou expirada.");
                return Response.json(200, new JSONObject()
                    .put("sessionToken", joined.sessionToken)
                    .put("expiresAt", joined.expiresAt)
                    .toString());
            }

            if ("POST".equals(request.method) && "/signals".equals(path)) {
                String role = query.get("role");
                if (!authorizeRequest(session, request, role)) return error(401, "Sessão não autorizada.");
                JSONObject body = request.json();
                if (!validSignalEnvelope(body, role)) return error(400, "Sinalização WebRTC inválida.");
                String payload = new String(request.body, StandardCharsets.UTF_8);
                boolean accepted = session.publishAuthorized(role, body.optString("messageId", ""), payload);
                if (!accepted) return error(401, "Sessão inválida, expirada ou mensagem repetida.");
                return Response.json(202, "{}");
            }

            if ("GET".equals(request.method) && "/signals".equals(path)) {
                String role = query.get("role");
                long cursor = parseLong(query.get("cursor"), 0L);
                if (!authorizeRequest(session, request, role)) return error(401, "Sessão não autorizada.");
                List<LanPairingSession.SignalMessage> messages = session.pollAuthorized(role, cursor);
                JSONArray items = new JSONArray();
                for (LanPairingSession.SignalMessage message : messages) items.put(new JSONObject(message.payload));
                return Response.json(200, new JSONObject()
                    .put("cursor", session.latestSequence())
                    .put("messages", items)
                    .toString());
            }

            if ("POST".equals(request.method) && "/close".equals(path)) {
                String role = query.get("role");
                if (!authorizeRequest(session, request, role)) return error(401, "Sessão não autorizada.");
                session.close();
                return Response.json(200, "{}");
            }

            return error(404, "Endpoint não encontrado.");
        } catch (IllegalArgumentException | JSONException error) {
            return error(400, "Requisição LAN inválida.");
        }
    }

    private static boolean authorizeRequest(LanPairingSession session, Request request, String role) {
        String authorization = request.headers.get("authorization");
        if ("remote".equals(role)) {
            return session.authorizeRemoteRequest(authorization, request.method, request.target, request.body);
        }
        return "tv".equals(role) && session.authorize("tv", bearer(authorization));
    }

    private Response receiverAsset(String requestPath) {
        String assetPath = requestPath.equals("/receiver") || requestPath.equals("/receiver/")
            ? "tv-offline-receiver.html"
            : requestPath.substring("/receiver/".length());
        if (assetPath.isEmpty()) assetPath = "tv-offline-receiver.html";
        if (assetPath.startsWith("/") || assetPath.contains("..") || assetPath.contains("\\")) {
            return error(400, "Asset inválido.");
        }
        try (InputStream input = assets.open(assetPath, AssetManager.ACCESS_STREAMING)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_RECEIVER_ASSET_BYTES) return error(413, "Asset excede limite.");
                output.write(buffer, 0, read);
            }
            return new Response(200, contentType(assetPath), output.toByteArray());
        } catch (FileNotFoundException error) {
            return error(404, "Asset do receiver não encontrado.");
        } catch (IOException error) {
            return error(500, "Falha ao ler receiver embarcado.");
        }
    }

    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".json")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }

    private static boolean validSignalEnvelope(JSONObject body, String role) {
        if (!("tv".equals(role) || "remote".equals(role))) return false;
        String messageId = body.optString("messageId", "");
        String from = body.optString("from", "");
        if (!role.equals(from) || messageId.length() < 16 || messageId.length() > LanPairingSession.MAX_MESSAGE_ID_LENGTH) return false;
        JSONObject signal = body.optJSONObject("signal");
        if (signal == null || !from.equals(signal.optString("from", ""))) return false;
        String type = signal.optString("type", "");
        if ("description".equals(type)) {
            JSONObject description = signal.optJSONObject("description");
            if (description == null) return false;
            String descriptionType = description.optString("type", "");
            String sdp = description.optString("sdp", "");
            return ("offer".equals(descriptionType) || "answer".equals(descriptionType)) && !sdp.isEmpty() && sdp.length() <= 256 * 1024;
        }
        if ("ice-candidate".equals(type)) {
            JSONObject candidate = signal.optJSONObject("candidate");
            if (candidate == null) return false;
            String value = candidate.optString("candidate", "");
            String sdpMid = candidate.isNull("sdpMid") ? "" : candidate.optString("sdpMid", "");
            String username = candidate.isNull("usernameFragment") ? "" : candidate.optString("usernameFragment", "");
            if (value.length() > 8 * 1024 || sdpMid.length() > 256 || username.length() > 256) return false;
            if (!candidate.isNull("sdpMLineIndex")) {
                int line = candidate.optInt("sdpMLineIndex", -1);
                if (line < 0 || line > 65_535) return false;
            }
            return true;
        }
        return false;
    }

    private synchronized boolean allowRequest(String ip) {
        long now = System.currentTimeMillis();
        pruneRateEntries(now);
        ArrayDeque<Long> times = requestTimes.get(ip);
        if (times == null) {
            if (requestTimes.size() >= MAX_RATE_IPS) return false;
            times = new ArrayDeque<>();
            requestTimes.put(ip, times);
        }
        while (!times.isEmpty() && now - times.peekFirst() > RATE_WINDOW_MS) times.removeFirst();
        if (times.size() >= RATE_MAX_REQUESTS) return false;
        times.addLast(now);
        return true;
    }

    private void pruneRateEntries(long now) {
        requestTimes.entrySet().removeIf(entry -> {
            ArrayDeque<Long> times = entry.getValue();
            while (!times.isEmpty() && now - times.peekFirst() > RATE_WINDOW_MS) times.removeFirst();
            return times.isEmpty();
        });
    }

    private boolean originAllowed(String origin, boolean loopback) {
        if (origin == null || origin.isEmpty()) return true;
        if (origin.equals(allowedOrigin)) return true;
        return loopback && (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:"));
    }

    private static String bearer(String header) {
        if (header == null || !header.startsWith("Bearer ")) return null;
        return header.substring("Bearer ".length()).trim();
    }

    private static long parseLong(String value, long fallback) {
        try {
            return value == null ? fallback : Long.parseLong(value);
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> values = new HashMap<>();
        if (raw == null || raw.isEmpty()) return values;
        for (String pair : raw.split("&")) {
            int separator = pair.indexOf('=');
            String key = separator < 0 ? pair : pair.substring(0, separator);
            String value = separator < 0 ? "" : pair.substring(separator + 1);
            values.put(urlDecode(key), urlDecode(value));
        }
        return values;
    }

    private static String urlDecode(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (Exception error) {
            return value;
        }
    }

    private static Request readRequest(InputStream source) throws IOException {
        BufferedInputStream input = new BufferedInputStream(source);
        String requestLine = readLine(input);
        if (requestLine == null || requestLine.isEmpty()) return null;
        String[] requestParts = requestLine.split(" ", 3);
        if (requestParts.length < 2) throw new IOException("Request line inválida.");
        Map<String, String> headers = new HashMap<>();
        int headerCount = 0;
        while (true) {
            String line = readLine(input);
            if (line == null || line.isEmpty()) break;
            headerCount += 1;
            if (headerCount > MAX_HEADER_COUNT) throw new IOException("Cabeçalhos excedem limite.");
            int separator = line.indexOf(':');
            if (separator > 0) headers.put(line.substring(0, separator).trim().toLowerCase(Locale.ROOT), line.substring(separator + 1).trim());
        }
        int length = (int) parseLong(headers.get("content-length"), 0L);
        if (length < 0 || length > LanPairingSession.MAX_REQUEST_BYTES) throw new IOException("Body excede limite.");
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(body, offset, length - offset);
            if (read < 0) throw new EOFException("Body incompleto.");
            offset += read;
        }
        return new Request(requestParts[0], requestParts[1], headers, body);
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int previous = -1;
        while (line.size() <= MAX_HEADER_LINE) {
            int current = input.read();
            if (current < 0) return line.size() == 0 ? null : line.toString("UTF-8");
            if (previous == '\r' && current == '\n') {
                byte[] bytes = line.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.UTF_8);
            }
            line.write(current);
            previous = current;
        }
        throw new IOException("Header excede limite.");
    }

    private static void writeResponse(Socket socket, String origin, Response response) throws IOException {
        BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream());
        String reason = response.status == 200 ? "OK"
            : response.status == 202 ? "Accepted"
            : response.status == 204 ? "No Content"
            : response.status == 400 ? "Bad Request"
            : response.status == 401 ? "Unauthorized"
            : response.status == 403 ? "Forbidden"
            : response.status == 404 ? "Not Found"
            : response.status == 410 ? "Gone"
            : response.status == 413 ? "Payload Too Large"
            : response.status == 429 ? "Too Many Requests"
            : "Error";
        StringBuilder headers = new StringBuilder()
            .append("HTTP/1.1 ").append(response.status).append(' ').append(reason).append("\r\n")
            .append("Content-Type: ").append(response.contentType).append("\r\n")
            .append("Content-Length: ").append(response.body.length).append("\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n")
            .append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            .append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n")
            .append("Access-Control-Allow-Private-Network: true\r\n");
        if (response.contentType.startsWith("text/html")) {
            headers.append("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'\r\n");
        }
        if (origin != null && !origin.isEmpty()) headers.append("Access-Control-Allow-Origin: ").append(origin).append("\r\nVary: Origin\r\n");
        headers.append("\r\n");
        output.write(headers.toString().getBytes(StandardCharsets.US_ASCII));
        output.write(response.body);
        output.flush();
    }

    private static Response error(int status, String message) {
        try {
            return Response.json(status, new JSONObject().put("error", message).toString());
        } catch (JSONException impossible) {
            return Response.json(status, "{\"error\":\"Erro LAN.\"}");
        }
    }

    @Override
    public synchronized void close() {
        running = false;
        pairingSession.close();
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // idempotente
            }
            serverSocket = null;
        }
        clients.shutdownNow();
        requestTimes.clear();
    }

    private static final class Request {
        final String method;
        final String target;
        final Map<String, String> headers;
        final byte[] body;

        Request(String method, String target, Map<String, String> headers, byte[] body) {
            this.method = method;
            this.target = target;
            this.headers = headers;
            this.body = body;
        }

        JSONObject json() throws JSONException {
            if (body.length == 0) return new JSONObject();
            return new JSONObject(new String(body, StandardCharsets.UTF_8));
        }
    }

    private static final class Response {
        final int status;
        final String contentType;
        final byte[] body;

        Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        static Response json(int status, String json) {
            return new Response(status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
        }
    }
}
