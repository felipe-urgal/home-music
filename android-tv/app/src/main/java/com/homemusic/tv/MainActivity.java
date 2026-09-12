package com.homemusic.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
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
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;

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
    private boolean canGoBack;

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
            showSetup(hasText(currentAddress) ? currentAddress : DEFAULT_URL);
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

        if (session != null && canGoBack) {
            session.goBack();
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setItems(new CharSequence[]{"Alterar endereço", "Adicionar à tela inicial", "Sair"}, (dialog, which) -> {
                if (which == 0) showSetup(hasText(currentAddress) ? currentAddress : DEFAULT_URL);
                else if (which == 1) requestHomeScreenShortcut();
                else finish();
            })
            .setNegativeButton("Cancelar", null)
            .show();
    }

    @Override
    protected void onDestroy() {
        destroyBrowser();
        super.onDestroy();
    }

    private void showSetup(String initialAddress) {
        showingSetup = true;
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
            "O modo TV é ativado automaticamente. O atalho na tela inicial depende do launcher instalado no BTV.",
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
        showingSetup = false;
        currentAddress = address;
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
                if (!success) showError("Não foi possível abrir o Home Music.");
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
        session.loadUri(withTvMode(address));
        browserView.requestFocus();
        enterImmersiveMode();
    }

    private LinearLayout buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(72), dp(48), dp(72), dp(48));
        panel.setBackgroundColor(BG);

        TextView title = text("Não foi possível abrir o Home Music", 24, TEXT);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        panel.addView(title);

        TextView message = text("Verifique o endereço e a conexão.", 16, MUTED);
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
        panel.addView(retry, new LinearLayout.LayoutParams(dp(320), dp(56)));
        retry.setOnClickListener(view -> {
            hideError();
            if (session != null && hasText(currentAddress)) session.loadUri(withTvMode(currentAddress));
        });

        Button settingsButton = new Button(this);
        settingsButton.setText("Alterar endereço");
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(dp(320), dp(52));
        settingsParams.topMargin = dp(10);
        panel.addView(settingsButton, settingsParams);
        settingsButton.setOnClickListener(view -> showSetup(hasText(currentAddress) ? currentAddress : DEFAULT_URL));

        return panel;
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
