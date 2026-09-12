package com.homemusic.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String PREFS = "home_music_tv";
    private static final String KEY_URL = "home_music_url";
    private static final int BG = Color.rgb(7, 13, 20);
    private static final int PANEL = Color.rgb(15, 24, 34);
    private static final int TEXT = Color.rgb(238, 244, 249);
    private static final int MUTED = Color.rgb(151, 164, 176);

    private SharedPreferences preferences;
    private WebView webView;
    private FrameLayout webRoot;
    private LinearLayout errorPanel;
    private ProgressBar progressBar;
    private String currentAddress;
    private boolean showingSetup;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        enterImmersiveMode();

        String savedAddress = preferences.getString(KEY_URL, "");
        if (!hasText(savedAddress)) {
            showSetup("");
        } else {
            showWeb(savedAddress);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyWebView();
        super.onDestroy();
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
                showWeb(saved);
                return;
            }
            super.onBackPressed();
            return;
        }

        if (webView != null && webView.canGoBack()) {
            webView.goBack();
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

    private void showSetup(String initialAddress) {
        showingSetup = true;
        destroyWebView();
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
        address.setSelectAllOnFocus(false);
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
            "Use HTTPS quando possível. Para um servidor local sem HTTPS, informe http:// explicitamente.",
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
            cancel.setOnClickListener(view -> showWeb(saved));
        }

        open.setOnClickListener(view -> {
            String normalized = normalizeAddress(address.getText().toString());
            if (normalized == null) {
                address.setError("Informe um endereço http:// ou https:// válido.");
                address.requestFocus();
                return;
            }
            preferences.edit().putString(KEY_URL, normalized).apply();
            showWeb(normalized);
        });

        setContentView(root);
        address.requestFocus();
        enterImmersiveMode();
    }

    private void showWeb(String address) {
        showingSetup = false;
        currentAddress = address;
        destroyWebView();

        webRoot = new FrameLayout(this);
        webRoot.setBackgroundColor(BG);
        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        configureWebView(webView);

        webRoot.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        progressBar = new ProgressBar(this);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.CENTER);
        webRoot.addView(progressBar, progressParams);

        errorPanel = buildErrorPanel();
        errorPanel.setVisibility(View.GONE);
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        webRoot.addView(errorPanel, errorParams);

        setContentView(webRoot);
        webView.loadUrl(address);
        webView.requestFocus();
        enterImmersiveMode();
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " HomeMusicTV/0.1");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                hideError();
                if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Não foi possível abrir o Home Music.");
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                    showError("O servidor Home Music respondeu com erro " + errorResponse.getStatusCode() + ".");
                }
            }
        });
    }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "Não há aplicativo para abrir este link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private LinearLayout buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(72), dp(48), dp(72), dp(48));
        panel.setBackgroundColor(BG);

        TextView title = text("Sem conexão com o Home Music", 24, TEXT);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        panel.addView(title);

        TextView message = text("Verifique a rede e tente novamente.", 16, MUTED);
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
            if (webView != null) webView.loadUrl(currentAddress);
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

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.loadUrl("about:blank");
        webView.clearHistory();
        webView.removeAllViews();
        webView.destroy();
        webView = null;
        webRoot = null;
        errorPanel = null;
        progressBar = null;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }

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
