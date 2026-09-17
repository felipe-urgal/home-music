package com.homemusic.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;

import java.io.IOException;

public final class MainActivity extends Activity {
    private static final String PREFS = "home_music_tv";
    private static final String KEY_URL = "home_music_url";
    private static final String DEFAULT_URL = "https://home-music.tail6ab100.ts.net/";
    private static final int BG = Color.rgb(7, 13, 20);
    private static final int PANEL = Color.rgb(15, 24, 34);
    private static final int TEXT = Color.rgb(238, 244, 249);
    private static final int MUTED = Color.rgb(151, 164, 176);

    private static GeckoRuntime runtime;

    private SharedPreferences preferences;
    private GeckoView browserView;
    private GeckoSession session;
    private LinearLayout errorPanel;
    private ProgressBar progressBar;
    private String currentAddress;
    private boolean showingSetup;
    private boolean offlineReceiverMode;
    private boolean canGoBack;
    private LanPairingServer lanServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        enterImmersiveMode();

        String savedAddress = preferences.getString(KEY_URL, "");
        if (hasText(savedAddress)) showBrowser(savedAddress);
        else showSetup(DEFAULT_URL);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP
            && (event.getKeyCode() == KeyEvent.KEYCODE_MENU || event.getKeyCode() == KeyEvent.KEYCODE_SETTINGS)) {
            showAppMenu();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (showingSetup) {
            String saved = preferences.getString(KEY_URL, "");
            if (hasText(saved)) {
                showBrowser(saved);
                return;
            }
            super.onBackPressed();
            return;
        }

        if (!offlineReceiverMode && session != null && canGoBack) {
            session.goBack();
            return;
        }

        showAppMenu();
    }

    @Override
    protected void onDestroy() {
        destroyBrowser();
        stopLanServer();
        super.onDestroy();
    }

    private void showAppMenu() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setItems(
                offlineReceiverMode
                    ? new CharSequence[]{"Novo pareamento offline", "Tentar modo online", "Alterar endereço", "Sair"}
                    : new CharSequence[]{"Modo offline local", "Alterar endereço", "Adicionar à tela inicial", "Sair"},
                (dialog, which) -> {
                    if (offlineReceiverMode) {
                        if (which == 0) showOfflinePairing();
                        else if (which == 1) showSavedServer();
                        else if (which == 2) showSetup(savedOrDefaultAddress());
                        else finish();
                    } else {
                        if (which == 0) showOfflinePairing();
                        else if (which == 1) showSetup(savedOrDefaultAddress());
                        else if (which == 2) requestHomeScreenShortcut();
                        else finish();
                    }
                }
            )
            .setNegativeButton("Cancelar", null)
            .show();
    }

    private void showSetup(String initialAddress) {
        showingSetup = true;
        offlineReceiverMode = false;
        stopLanServer();
        destroyBrowser();
        currentAddress = initialAddress;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(BG);
        root.setPadding(dp(72), dp(48), dp(72), dp(48));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(36), dp(30), dp(36), dp(30));
        card.setBackgroundColor(PANEL);
        root.addView(card, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text("Home Music TV", 28, TEXT);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        card.addView(title);

        TextView subtitle = text(
            "O endereço padrão já está preenchido. Altere somente se o servidor mudar.",
            16,
            MUTED
        );
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.topMargin = dp(8);
        subtitleParams.bottomMargin = dp(22);
        card.addView(subtitle, subtitleParams);

        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setText(hasText(initialAddress) ? initialAddress : DEFAULT_URL);
        address.setHint(DEFAULT_URL);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setTextSize(18);
        card.addView(address, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        ));

        Button open = new Button(this);
        open.setText("Abrir Home Music");
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        );
        buttonParams.topMargin = dp(18);
        card.addView(open, buttonParams);

        Button offline = new Button(this);
        offline.setText("Usar modo offline local");
        LinearLayout.LayoutParams offlineParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        offlineParams.topMargin = dp(10);
        card.addView(offline, offlineParams);
        offline.setOnClickListener(view -> showOfflinePairing());

        Button pin = new Button(this);
        pin.setText("Adicionar à tela inicial");
        LinearLayout.LayoutParams pinParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        pinParams.topMargin = dp(10);
        card.addView(pin, pinParams);
        pin.setOnClickListener(view -> requestHomeScreenShortcut());

        TextView note = text(
            "O modo offline local funciona sem o servidor quando o celular e o BTV estão na mesma rede e a música já foi baixada no celular.",
            13,
            MUTED
        );
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        noteParams.topMargin = dp(16);
        card.addView(note, noteParams);

        String saved = preferences.getString(KEY_URL, "");
        if (hasText(saved)) {
            Button cancel = new Button(this);
            cancel.setText("Cancelar");
            LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
            );
            cancelParams.topMargin = dp(10);
            card.addView(cancel, cancelParams);
            cancel.setOnClickListener(view -> showBrowser(saved));
        }

        open.setOnClickListener(view -> {
            String normalized = normalizeAddress(address.getText().toString());
            if (normalized == null) {
                address.setError("Informe um endereço http:// ou https:// válido.");
                address.requestFocus();
                return;
            }
            preferences.edit().putString(KEY_URL, normalized).apply();
            showBrowser(normalized);
        });

        setContentView(root);
        open.requestFocus();
        enterImmersiveMode();
    }

    private void showBrowser(String address) {
        stopLanServer();
        offlineReceiverMode = false;
        currentAddress = address;
        showBrowserUri(withTvMode(address));
    }

    private void showBrowserUri(String uri) {
        showingSetup = false;
        canGoBack = false;
        destroyBrowser();

        FrameLayout browserRoot = new FrameLayout(this);
        browserRoot.setBackgroundColor(BG);

        browserView = new GeckoView(this);
        browserView.setBackgroundColor(BG);
        browserView.setFocusable(true);
        browserView.setFocusableInTouchMode(true);
        browserRoot.addView(browserView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        progressBar = new ProgressBar(this);
        browserRoot.addView(progressBar, new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER));

        errorPanel = buildErrorPanel();
        errorPanel.setVisibility(View.GONE);
        browserRoot.addView(errorPanel, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(browserRoot);

        GeckoSessionSettings sessionSettings = new GeckoSessionSettings.Builder()
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
            .displayMode(GeckoSessionSettings.DISPLAY_MODE_STANDALONE)
            .usePrivateMode(false)
            .useTrackingProtection(false)
            .suspendMediaWhenInactive(false)
            .build();

        session = new GeckoSession(sessionSettings);
        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            @Override
            public GeckoResult<Integer> onContentPermissionRequest(
                GeckoSession geckoSession,
                ContentPermission permission
            ) {
                if (offlineReceiverMode
                    && (permission.permission == PERMISSION_AUTOPLAY_AUDIBLE
                        || permission.permission == PERMISSION_AUTOPLAY_INAUDIBLE)) {
                    return GeckoResult.fromValue(ContentPermission.VALUE_ALLOW);
                }
                return GeckoResult.fromValue(ContentPermission.VALUE_PROMPT);
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override
            public void onCrash(GeckoSession crashedSession) {
                showError("O navegador interno foi encerrado. Tente novamente.");
            }
        });
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStart(GeckoSession geckoSession, String url) {
                hideError();
                if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageStop(GeckoSession geckoSession, boolean success) {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                if (!success) {
                    showError(
                        offlineReceiverMode
                            ? "Não foi possível abrir o receiver offline embarcado."
                            : "Não foi possível abrir o Home Music. Use o modo offline local se o servidor estiver indisponível."
                    );
                }
            }
        });
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override
            public void onCanGoBack(GeckoSession geckoSession, boolean value) {
                canGoBack = value;
            }
        });

        if (runtime == null) runtime = GeckoRuntime.create(getApplicationContext());
        session.open(runtime);
        browserView.setSession(session);
        session.loadUri(uri);
        browserView.requestFocus();
        enterImmersiveMode();
    }

    private void showOfflinePairing() {
        showingSetup = false;
        offlineReceiverMode = true;
        destroyBrowser();
        stopLanServer();

        try {
            LanPairingServer nextServer = new LanPairingServer(
                originFor(savedOrDefaultAddress()),
                getAssets(),
                joinedServer -> runOnUiThread(() -> {
                    if (offlineReceiverMode && lanServer == joinedServer) openOfflineReceiver();
                })
            );
            lanServer = nextServer;
            lanServer.start();
            LanPairingServer.PairingInfo info = lanServer.pairingInfo();

            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.HORIZONTAL);
            root.setGravity(Gravity.CENTER);
            root.setBackgroundColor(BG);
            root.setPadding(dp(56), dp(42), dp(56), dp(42));

            ImageView qr = new ImageView(this);
            qr.setImageBitmap(createQrBitmap(info.qrText, dp(330)));
            LinearLayout.LayoutParams qrParams = new LinearLayout.LayoutParams(dp(360), dp(360));
            qrParams.rightMargin = dp(48);
            root.addView(qr, qrParams);

            LinearLayout copy = new LinearLayout(this);
            copy.setOrientation(LinearLayout.VERTICAL);
            copy.setGravity(Gravity.CENTER_VERTICAL);
            root.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

            TextView badge = text("Modo offline local", 16, MUTED);
            copy.addView(badge);
            TextView title = text("Conectar celular", 32, TEXT);
            title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
            LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            titleParams.topMargin = dp(8);
            copy.addView(title, titleParams);

            TextView detail = text(
                "No Home Music do celular, abra Downloads → Conectar à TV e escaneie este QR. A Internet e o servidor podem permanecer desligados.",
                18,
                MUTED
            );
            LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            detailParams.topMargin = dp(12);
            detailParams.bottomMargin = dp(20);
            copy.addView(detail, detailParams);

            TextView address = text("TV na rede local: " + info.host + ":" + info.port, 14, MUTED);
            copy.addView(address);

            Button receiver = new Button(this);
            receiver.setText("Abrir receiver offline");
            LinearLayout.LayoutParams receiverParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(58)
            );
            receiverParams.topMargin = dp(20);
            copy.addView(receiver, receiverParams);
            receiver.setOnClickListener(view -> openOfflineReceiver());

            Button regenerate = new Button(this);
            regenerate.setText("Gerar novo QR");
            LinearLayout.LayoutParams regenerateParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
            );
            regenerateParams.topMargin = dp(10);
            copy.addView(regenerate, regenerateParams);
            regenerate.setOnClickListener(view -> showOfflinePairing());

            Button online = new Button(this);
            online.setText("Tentar modo online");
            LinearLayout.LayoutParams onlineParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(52)
            );
            onlineParams.topMargin = dp(10);
            copy.addView(online, onlineParams);
            online.setOnClickListener(view -> showSavedServer());

            setContentView(root);
            receiver.requestFocus();
            enterImmersiveMode();
        } catch (IOException | WriterException error) {
            stopLanServer();
            offlineReceiverMode = false;
            new AlertDialog.Builder(this)
                .setTitle("Modo offline indisponível")
                .setMessage(error.getMessage() == null ? "Não foi possível iniciar o serviço local da TV." : error.getMessage())
                .setPositiveButton("Voltar", (dialog, which) -> showSetup(savedOrDefaultAddress()))
                .setCancelable(false)
                .show();
        }
    }

    private void openOfflineReceiver() {
        if (lanServer == null || lanServer.port() < 1) {
            showOfflinePairing();
            return;
        }
        offlineReceiverMode = true;
        String receiverUrl = "http://127.0.0.1:" + lanServer.port() + "/receiver/tv-offline-receiver.html";
        showBrowserUri(receiverUrl);
    }

    private LinearLayout buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(72), dp(48), dp(72), dp(48));
        panel.setBackgroundColor(BG);

        TextView title = text(offlineReceiverMode ? "Receiver offline indisponível" : "Não foi possível abrir o Home Music", 24, TEXT);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        panel.addView(title);

        TextView message = text("Verifique a conexão e tente novamente.", 16, MUTED);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        messageParams.topMargin = dp(8);
        messageParams.bottomMargin = dp(22);
        panel.addView(message, messageParams);
        panel.setTag(message);

        Button retry = new Button(this);
        retry.setText("Tentar novamente");
        panel.addView(retry, new LinearLayout.LayoutParams(dp(340), dp(56)));
        retry.setOnClickListener(view -> {
            hideError();
            if (offlineReceiverMode) openOfflineReceiver();
            else if (session != null && hasText(currentAddress)) session.loadUri(withTvMode(currentAddress));
        });

        Button alternate = new Button(this);
        alternate.setText(offlineReceiverMode ? "Tentar modo online" : "Usar modo offline local");
        LinearLayout.LayoutParams alternateParams = new LinearLayout.LayoutParams(dp(340), dp(52));
        alternateParams.topMargin = dp(10);
        panel.addView(alternate, alternateParams);
        alternate.setOnClickListener(view -> {
            if (offlineReceiverMode) showSavedServer();
            else showOfflinePairing();
        });

        Button settingsButton = new Button(this);
        settingsButton.setText("Alterar endereço");
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(dp(340), dp(52));
        settingsParams.topMargin = dp(10);
        panel.addView(settingsButton, settingsParams);
        settingsButton.setOnClickListener(view -> showSetup(savedOrDefaultAddress()));

        return panel;
    }

    private void showSavedServer() {
        showBrowser(savedOrDefaultAddress());
    }

    private String savedOrDefaultAddress() {
        String saved = preferences.getString(KEY_URL, "");
        if (hasText(saved)) return saved;
        if (hasText(currentAddress)) return currentAddress;
        return DEFAULT_URL;
    }

    private static String originFor(String address) {
        Uri uri = Uri.parse(address);
        if (!hasText(uri.getScheme()) || !hasText(uri.getAuthority())) return "";
        return uri.getScheme() + "://" + uri.getAuthority();
    }

    private static Bitmap createQrBitmap(String value, int size) throws WriterException {
        BitMatrix matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, size, size);
        int width = matrix.getWidth();
        int height = matrix.getHeight();
        int[] pixels = new int[width * height];
        for (int y = 0; y < height; y += 1) {
            int row = y * width;
            for (int x = 0; x < width; x += 1) {
                pixels[row + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
            }
        }
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height);
        return bitmap;
    }

    private void stopLanServer() {
        if (lanServer == null) return;
        lanServer.close();
        lanServer = null;
    }

    private void requestHomeScreenShortcut() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            showShortcutUnsupported();
            return;
        }

        ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
        if (shortcutManager == null || !shortcutManager.isRequestPinShortcutSupported()) {
            showShortcutUnsupported();
            return;
        }

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);

        ShortcutInfo shortcut = new ShortcutInfo.Builder(this, "home-music-tv")
            .setShortLabel("Home Music")
            .setLongLabel("Home Music TV")
            .setIcon(Icon.createWithResource(this, R.drawable.ic_launcher))
            .setIntent(launchIntent)
            .build();

        boolean requested = shortcutManager.requestPinShortcut(shortcut, null);
        if (requested) {
            Toast.makeText(this, "Pedido enviado ao launcher. Confirme o atalho se o BTV solicitar.", Toast.LENGTH_LONG).show();
        } else {
            showShortcutUnsupported();
        }
    }

    private void showShortcutUnsupported() {
        new AlertDialog.Builder(this)
            .setTitle("Tela inicial do BTV")
            .setMessage(
                "O launcher deste BTV não oferece a API padrão para fixar atalhos. "
                    + "O Home Music continua instalado e aparece na lista de aplicativos; a tela inicial depende do launcher do aparelho."
            )
            .setPositiveButton("OK", null)
            .show();
    }

    private void showError(String message) {
        if (progressBar != null) progressBar.setVisibility(View.GONE);
        if (errorPanel == null) return;
        Object tag = errorPanel.getTag();
        if (tag instanceof TextView) ((TextView) tag).setText(message);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
    }

    private void destroyBrowser() {
        if (session != null) {
            session.close();
            session = null;
        }
        browserView = null;
        errorPanel = null;
        progressBar = null;
        canGoBack = false;
    }

    private static String normalizeAddress(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return null;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) return null;
        if (!hasText(uri.getHost())) return null;
        return uri.toString();
    }

    private static String withTvMode(String address) {
        Uri uri = Uri.parse(address);
        if ("1".equals(uri.getQueryParameter("tv"))) return uri.toString();
        return uri.buildUpon().appendQueryParameter("tv", "1").build().toString();
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }
}
