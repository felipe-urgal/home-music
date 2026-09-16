package com.homemusic.tv;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class LanPairingSession {
    static final String VERSION = "home-music-lan-remote-v1";
    static final long PAIRING_TTL_MS = 120_000L;
    static final long ESTABLISHED_TTL_MS = 1_800_000L;
    static final int MAX_PENDING_SIGNALS = 128;
    static final int MAX_REQUEST_BYTES = 320 * 1024;
    static final int MAX_MESSAGE_ID_LENGTH = 64;

    interface Clock {
        long now();
    }

    static final class Challenge {
        final String sessionId;
        final String clientNonce;
        final String tvNonce;
        final long expiresAt;

        Challenge(String sessionId, String clientNonce, String tvNonce, long expiresAt) {
            this.sessionId = sessionId;
            this.clientNonce = clientNonce;
            this.tvNonce = tvNonce;
            this.expiresAt = expiresAt;
        }
    }

    static final class JoinResult {
        final String sessionToken;
        final long expiresAt;

        JoinResult(String sessionToken, long expiresAt) {
            this.sessionToken = sessionToken;
            this.expiresAt = expiresAt;
        }
    }

    static final class SignalMessage {
        final long sequence;
        final String from;
        final String messageId;
        final String payload;

        SignalMessage(long sequence, String from, String messageId, String payload) {
            this.sequence = sequence;
            this.from = from;
            this.messageId = messageId;
            this.payload = payload;
        }
    }

    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{16,192}");
    private static final char[] BASE64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
    private final SecureRandom random;
    private final Clock clock;
    private final String sessionId;
    private String secret;
    private final String receiverToken;
    private final long pairingExpiresAt;
    private final Map<String, Challenge> challenges = new HashMap<>();
    private final Set<String> seenMessageIds = new HashSet<>();
    private final Deque<SignalMessage> mailbox = new ArrayDeque<>();
    private String remoteToken;
    private long establishedExpiresAt;
    private long sequence;
    private boolean joined;
    private boolean closed;

    LanPairingSession() {
        this(new SecureRandom(), System::currentTimeMillis);
    }

    LanPairingSession(SecureRandom random, Clock clock) {
        this.random = random;
        this.clock = clock;
        this.sessionId = randomToken(16);
        this.secret = randomToken(32);
        this.receiverToken = randomToken(32);
        this.pairingExpiresAt = clock.now() + PAIRING_TTL_MS;
    }

    synchronized String sessionId() {
        return sessionId;
    }

    synchronized String pairingSecret() {
        return secret;
    }

    synchronized String receiverToken() {
        return receiverToken;
    }

    synchronized long pairingExpiresAt() {
        return pairingExpiresAt;
    }

    synchronized long receiverExpiresAt() {
        expireIfNeeded();
        if (closed) return 0L;
        return joined ? establishedExpiresAt : pairingExpiresAt;
    }

    synchronized boolean isClosed() {
        expireIfNeeded();
        return closed;
    }

    synchronized Challenge createChallenge(String clientNonce) {
        expireIfNeeded();
        if (closed || joined || !validToken(clientNonce, 128)) return null;
        if (challenges.size() >= 32) challenges.clear();
        String tvNonce = randomToken(16);
        long expiresAt = Math.min(pairingExpiresAt, clock.now() + 60_000L);
        Challenge challenge = new Challenge(sessionId, clientNonce, tvNonce, expiresAt);
        challenges.put(challengeKey(clientNonce, tvNonce), challenge);
        return challenge;
    }

    synchronized JoinResult join(String clientNonce, String tvNonce, long expiresAt, String proof) {
        expireIfNeeded();
        if (closed || joined || secret == null) return null;
        Challenge challenge = challenges.remove(challengeKey(clientNonce, tvNonce));
        if (challenge == null || challenge.expiresAt != expiresAt || expiresAt < clock.now()) return null;
        byte[] expected = hmac(secret, proofMessage(challenge));
        byte[] provided = decodeBase64Url(proof);
        if (provided == null || !MessageDigest.isEqual(expected, provided)) return null;
        joined = true;
        remoteToken = randomToken(32);
        establishedExpiresAt = clock.now() + ESTABLISHED_TTL_MS;
        secret = null;
        challenges.clear();
        return new JoinResult(remoteToken, establishedExpiresAt);
    }

    synchronized boolean authorize(String role, String token) {
        expireIfNeeded();
        if (closed || !validToken(token, 192)) return false;
        if ("tv".equals(role)) return MessageDigest.isEqual(
            receiverToken.getBytes(StandardCharsets.US_ASCII),
            token.getBytes(StandardCharsets.US_ASCII)
        );
        if (!"remote".equals(role) || !joined || remoteToken == null) return false;
        return MessageDigest.isEqual(
            remoteToken.getBytes(StandardCharsets.US_ASCII),
            token.getBytes(StandardCharsets.US_ASCII)
        );
    }

    synchronized boolean publish(String role, String token, String messageId, String payload) {
        if (!authorize(role, token) || !validToken(messageId, MAX_MESSAGE_ID_LENGTH) || payload == null
            || payload.getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_BYTES) return false;
        if (!seenMessageIds.add(messageId)) return false;
        sequence += 1;
        mailbox.addLast(new SignalMessage(sequence, role, messageId, payload));
        while (mailbox.size() > MAX_PENDING_SIGNALS) {
            SignalMessage removed = mailbox.removeFirst();
            seenMessageIds.remove(removed.messageId);
        }
        return true;
    }

    synchronized List<SignalMessage> poll(String role, String token, long cursor) {
        List<SignalMessage> result = new ArrayList<>();
        if (!authorize(role, token)) return result;
        for (SignalMessage message : mailbox) {
            if (message.sequence > cursor && !message.from.equals(role)) result.add(message);
        }
        return result;
    }

    synchronized long latestSequence() {
        return sequence;
    }

    synchronized void close() {
        closed = true;
        secret = null;
        remoteToken = null;
        challenges.clear();
        seenMessageIds.clear();
        mailbox.clear();
    }

    static String proofMessage(Challenge challenge) {
        return VERSION + "\n"
            + challenge.sessionId + "\n"
            + challenge.clientNonce + "\n"
            + challenge.tvNonce + "\n"
            + challenge.expiresAt;
    }

    static String computeProof(String secret, Challenge challenge) {
        return base64Url(hmac(secret, proofMessage(challenge)));
    }

    private void expireIfNeeded() {
        long now = clock.now();
        if ((!joined && now > pairingExpiresAt) || (joined && now > establishedExpiresAt)) close();
    }

    private static String challengeKey(String clientNonce, String tvNonce) {
        return clientNonce + ':' + tvNonce;
    }

    private static boolean validToken(String value, int maxLength) {
        return value != null && value.length() <= maxLength && TOKEN.matcher(value).matches();
    }

    private String randomToken(int bytes) {
        byte[] value = new byte[bytes];
        random.nextBytes(value);
        return hex(value);
    }

    private static byte[] hmac(String secretHex, String message) {
        byte[] secretBytes = decodeHex(secretHex);
        if (secretBytes == null) throw new IllegalArgumentException("Segredo LAN inválido.");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secretBytes, "HmacSHA256"));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("HmacSHA256 indisponível.", error);
        }
    }

    private static String hex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        char[] alphabet = "0123456789abcdef".toCharArray();
        for (int i = 0; i < bytes.length; i += 1) {
            int value = bytes[i] & 0xff;
            out[i * 2] = alphabet[value >>> 4];
            out[i * 2 + 1] = alphabet[value & 0x0f];
        }
        return new String(out);
    }

    private static byte[] decodeHex(String value) {
        if (value == null || (value.length() & 1) != 0) return null;
        byte[] out = new byte[value.length() / 2];
        for (int i = 0; i < value.length(); i += 2) {
            int hi = Character.digit(value.charAt(i), 16);
            int lo = Character.digit(value.charAt(i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i / 2] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    private static String base64Url(byte[] bytes) {
        StringBuilder out = new StringBuilder((bytes.length * 4 + 2) / 3);
        for (int index = 0; index < bytes.length; index += 3) {
            int first = bytes[index] & 0xff;
            int second = index + 1 < bytes.length ? bytes[index + 1] & 0xff : -1;
            int third = index + 2 < bytes.length ? bytes[index + 2] & 0xff : -1;
            out.append(BASE64_URL[first >>> 2]);
            out.append(BASE64_URL[((first & 0x03) << 4) | (second < 0 ? 0 : second >>> 4)]);
            if (second >= 0) out.append(BASE64_URL[((second & 0x0f) << 2) | (third < 0 ? 0 : third >>> 6)]);
            if (third >= 0) out.append(BASE64_URL[third & 0x3f]);
        }
        return out.toString();
    }

    private static byte[] decodeBase64Url(String value) {
        if (value == null || value.isEmpty() || value.length() % 4 == 1) return null;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int accumulator = 0;
        int bits = 0;
        for (int index = 0; index < value.length(); index += 1) {
            int decoded = base64Value(value.charAt(index));
            if (decoded < 0) return null;
            accumulator = (accumulator << 6) | decoded;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((accumulator >>> bits) & 0xff);
            }
        }
        if (bits > 0 && (accumulator & ((1 << bits) - 1)) != 0) return null;
        return out.toByteArray();
    }

    private static int base64Value(char value) {
        if (value >= 'A' && value <= 'Z') return value - 'A';
        if (value >= 'a' && value <= 'z') return value - 'a' + 26;
        if (value >= '0' && value <= '9') return value - '0' + 52;
        if (value == '-') return 62;
        if (value == '_') return 63;
        return -1;
    }
}
