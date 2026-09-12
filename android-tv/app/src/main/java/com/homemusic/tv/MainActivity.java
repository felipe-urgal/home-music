package com.homemusic.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
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

import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;

public final class MainActivity extends Activity {
    private static final String PREFS = "home_music_tv";
    private static final String KEY_URL = "home_music_url";
    private static final int BG = Color.rgb(7, 13, 20);
    private static final int PANEL = Color.rgb(15, 24, 34);
    private static final int TEXT = Color.rgb(238, 244, 249);
    private static final int MUTED = Color.rgb(151, 164, 176);

    private static GeckoRuntime runtime;

    private SharedPreferences preferences;
    private GeckoView browserView;
    private GeckoSession session;
    private FrameLayout browserRoot;
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
        if (!hasText(savedAddress)) showSetup("");
        else showBrowser(savedAddress);
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
            showSetup(currentAddress == null ? "" : currentAddress);
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
            .setItems(new CharSequence[]{"Alterar endereço", "Sair"}, (dialog, which) -> {
                if (which == 0) showSetup(currentAddress == null ? "" : currentAddress);
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
            "Informe o endereço do seu Home Music. Ele fica salvo somente neste aparelho.",
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
        address.setText(hasText(initialAddress) ? initialAddress : "https://");
        address.setHint("https://musica.exemplo.com");
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

        TextView note = text(
            "Esta versão usa um navegador próprio para não depender do WebView antigo do BTV.",
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
        address.requestFocus();
        enterImmersiveMode();
    }

    private void showBrowser(String address) {
        showingSetup = false;
        currentAddress = address;
        canGoBack = false;
        destroyBrowser();

        browserRoot = new FrameLayout(this);
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
        browserRoot.addView(
            progressBar,
            new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER)
        );

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
        session.loadUri(address);
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
            if (session != null && hasText(currentAddress)) session.loadUri(currentAddress);
        });

        Button settingsButton = new Button(this);
        settingsButton.setText("Alterar endereço");
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(dp(320), dp(52));
        settingsParams.topMargin = dp(10);
        panel.addView(settingsButton, settingsParams);
        settingsButton.setOnClickListener(view -> showSetup(currentAddress));

        return panel;
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
        browserRoot = null;
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
