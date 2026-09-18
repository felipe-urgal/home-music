package com.homemusic.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
import java.net.HttpURLConnection;
import java.net.URL;

public final class MainActivity extends Activity {
    private static final String PREFS = "home_music_tv";
    private static final String KEY_URL = "home_music_url";
    private static final String DEFAULT_URL = "https://home-music.tail6ab100.ts.net/";
    private static final int BG = Color.rgb(7, 13, 20);
    private static final int PANEL = Color.rgb(15, 24, 34);
    private static final int TEXT = Color.rgb(238, 244, 249);
    private static final int MUTED = Color.rgb(151, 164, 176);
    private static final int SETUP_TEXT = Color.rgb(246, 249, 255);
    private static final int SETUP_MUTED = Color.rgb(185, 205, 235);
    private static final int SETUP_ACCENT = Color.rgb(40, 139, 255);
    private static final int SETUP_ACCENT_BRIGHT = Color.rgb(86, 214, 255);
    private static final int SETUP_SUCCESS = Color.rgb(53, 232, 143);
    private static final int SETUP_DANGER = Color.rgb(255, 117, 117);
    private static final int SETUP_OPEN = 0;
    private static final int SETUP_OFFLINE = 1;
    private static final int SETUP_SERVER = 2;
    private static final int SETUP_SHORTCUT = 3;

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
    private TextView setupDetailLabel;
    private TextView setupDetailTitle;
    private TextView setupDetailDescription;
    private View setupStatusDot;
    private TextView setupStatusTitle;
    private TextView setupStatusDetail;
    private int setupFocusedAction = SETUP_OPEN;
    private boolean setupServerReachabilityKnown;
    private boolean setupServerReachable;

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

        String normalized = normalizeAddress(initialAddress);
        currentAddress = normalized == null ? DEFAULT_URL : normalized;
        setupFocusedAction = SETUP_OPEN;
        setupServerReachabilityKnown = false;
        setupServerReachable = false;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp(48), dp(34), dp(48), dp(34));
        root.setBackground(setupScreenBackground());

        LinearLayout menu = new LinearLayout(this);
        menu.setOrientation(LinearLayout.VERTICAL);
        menu.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams menuParams = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.MATCH_PARENT,
            46
        );
        menuParams.rightMargin = dp(34);
        root.addView(menu, menuParams);

        TextView title = text("Home Music TV", 36, SETUP_TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        menu.addView(title);

        TextView subtitle = text("Sua música, do seu jeito.", 18, SETUP_MUTED);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.topMargin = dp(3);
        subtitleParams.bottomMargin = dp(26);
        menu.addView(subtitle, subtitleParams);

        LinearLayout open = createSetupMenuItem(
            SETUP_OPEN,
            R.drawable.ic_tv_play,
            "Abrir Home Music",
            this::openConfiguredServer
        );
        menu.addView(open, setupMenuParams(false));

        LinearLayout offline = createSetupMenuItem(
            SETUP_OFFLINE,
            R.drawable.ic_tv_music,
            "Modo offline local",
            this::showOfflinePairing
        );
        menu.addView(offline, setupMenuParams(true));

        LinearLayout server = createSetupMenuItem(
            SETUP_SERVER,
            R.drawable.ic_tv_server,
            "Alterar servidor",
            this::showServerAddressDialog
        );
        menu.addView(server, setupMenuParams(true));

        LinearLayout shortcut = createSetupMenuItem(
            SETUP_SHORTCUT,
            R.drawable.ic_tv_add,
            "Adicionar à tela inicial",
            this::requestHomeScreenShortcut
        );
        menu.addView(shortcut, setupMenuParams(true));

        View divider = new View(this);
        divider.setBackgroundColor(Color.argb(90, 103, 166, 255));
        LinearLayout.LayoutParams dividerParams = new LinearLayout.LayoutParams(
            dp(1),
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        dividerParams.rightMargin = dp(32);
        root.addView(divider, dividerParams);

        FrameLayout detailCard = new FrameLayout(this);
        detailCard.setBackground(setupDetailBackground());
        LinearLayout.LayoutParams detailCardParams = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.MATCH_PARENT,
            54
        );
        root.addView(detailCard, detailCardParams);

        ImageView decoration = new ImageView(this);
        decoration.setImageResource(R.drawable.ic_tv_music);
        decoration.setColorFilter(Color.rgb(91, 145, 255));
        decoration.setAlpha(0.16f);
        FrameLayout.LayoutParams decorationParams = new FrameLayout.LayoutParams(
            dp(118),
            dp(118),
            Gravity.TOP | Gravity.END
        );
        decorationParams.topMargin = dp(18);
        decorationParams.rightMargin = dp(20);
        detailCard.addView(decoration, decorationParams);

        LinearLayout detailContent = new LinearLayout(this);
        detailContent.setOrientation(LinearLayout.VERTICAL);
        detailContent.setPadding(dp(34), dp(36), dp(34), dp(30));
        detailCard.addView(detailContent, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setupDetailLabel = text("HOME MUSIC TV", 12, Color.rgb(158, 190, 238));
        setupDetailLabel.setLetterSpacing(0.16f);
        detailContent.addView(setupDetailLabel);

        setupDetailTitle = text("", 29, SETUP_TEXT);
        setupDetailTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams detailTitleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailTitleParams.topMargin = dp(16);
        detailContent.addView(setupDetailTitle, detailTitleParams);

        setupDetailDescription = text("", 18, SETUP_MUTED);
        setupDetailDescription.setLineSpacing(dp(2), 1f);
        LinearLayout.LayoutParams detailDescriptionParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailDescriptionParams.topMargin = dp(14);
        detailContent.addView(setupDetailDescription, detailDescriptionParams);

        View detailSpacer = new View(this);
        detailContent.addView(detailSpacer, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1
        ));

        View horizontalRule = new View(this);
        horizontalRule.setBackgroundColor(Color.argb(100, 134, 178, 239));
        LinearLayout.LayoutParams ruleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(1)
        );
        ruleParams.bottomMargin = dp(24);
        detailContent.addView(horizontalRule, ruleParams);

        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER_VERTICAL);
        detailContent.addView(statusRow);

        setupStatusDot = new View(this);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(11), dp(11));
        dotParams.rightMargin = dp(12);
        statusRow.addView(setupStatusDot, dotParams);

        setupStatusTitle = text("", 17, SETUP_TEXT);
        setupStatusTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        statusRow.addView(setupStatusTitle);

        setupStatusDetail = text("", 14, SETUP_MUTED);
        LinearLayout.LayoutParams statusDetailParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        statusDetailParams.leftMargin = dp(23);
        statusDetailParams.topMargin = dp(6);
        detailContent.addView(setupStatusDetail, statusDetailParams);

        renderSetupDetails(SETUP_OPEN);

        setContentView(root);
        open.requestFocus();
        checkSetupServerReachability(currentAddress);
        enterImmersiveMode();
    }

    private LinearLayout.LayoutParams setupMenuParams(boolean withTopMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(68)
        );
        if (withTopMargin) params.topMargin = dp(10);
        return params;
    }

    private LinearLayout createSetupMenuItem(
        int action,
        int iconResource,
        String label,
        Runnable onClick
    ) {
        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.HORIZONTAL);
        item.setGravity(Gravity.CENTER_VERTICAL);
        item.setPadding(dp(19), 0, dp(16), 0);
        item.setFocusable(true);
        item.setFocusableInTouchMode(true);
        item.setClickable(true);
        item.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        item.setBackground(setupMenuBackground(false));

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconResource);
        icon.setColorFilter(Color.rgb(210, 226, 250));
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(30), dp(30));
        iconParams.rightMargin = dp(18);
        item.addView(icon, iconParams);

        TextView labelView = text(label, 20, SETUP_TEXT);
        item.addView(labelView, new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1
        ));

        ImageView chevron = new ImageView(this);
        chevron.setImageResource(R.drawable.ic_tv_chevron_right);
        chevron.setColorFilter(Color.rgb(205, 222, 248));
        item.addView(chevron, new LinearLayout.LayoutParams(dp(24), dp(24)));

        item.setOnFocusChangeListener((view, hasFocus) -> {
            item.setBackground(setupMenuBackground(hasFocus));
            item.setElevation(hasFocus ? dp(12) : dp(1));
            icon.setColorFilter(hasFocus ? Color.WHITE : Color.rgb(210, 226, 250));
            chevron.setColorFilter(hasFocus ? Color.WHITE : Color.rgb(205, 222, 248));
            labelView.setTypeface(Typeface.DEFAULT, hasFocus ? Typeface.BOLD : Typeface.NORMAL);
            item.animate()
                .scaleX(hasFocus ? 1.015f : 1f)
                .scaleY(hasFocus ? 1.015f : 1f)
                .setDuration(120)
                .start();
            if (hasFocus) {
                setupFocusedAction = action;
                renderSetupDetails(action);
            }
        });
        item.setOnClickListener(view -> onClick.run());
        return item;
    }

    private GradientDrawable setupScreenBackground() {
        return new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{
                Color.rgb(3, 14, 43),
                Color.rgb(5, 52, 139),
                Color.rgb(3, 20, 61)
            }
        );
    }

    private GradientDrawable setupDetailBackground() {
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{
                Color.rgb(13, 54, 126),
                Color.rgb(8, 35, 89)
            }
        );
        background.setCornerRadius(dp(14));
        background.setStroke(dp(1), Color.argb(150, 83, 151, 244));
        return background;
    }

    private GradientDrawable setupMenuBackground(boolean focused) {
        GradientDrawable background = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            focused
                ? new int[]{Color.rgb(19, 120, 255), Color.rgb(14, 87, 223)}
                : new int[]{Color.rgb(16, 54, 112), Color.rgb(12, 42, 91)}
        );
        background.setCornerRadius(dp(13));
        background.setStroke(
            dp(focused ? 2 : 1),
            focused ? SETUP_ACCENT_BRIGHT : Color.argb(125, 106, 157, 232)
        );
        return background;
    }

    private GradientDrawable setupStatusDotBackground(int color) {
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(color);
        return dot;
    }

    private void renderSetupDetails(int action) {
        if (setupDetailTitle == null || setupStatusTitle == null) return;

        if (action == SETUP_OFFLINE) {
            setupDetailLabel.setText("MODO OFFLINE LOCAL");
            setupDetailTitle.setText("Modo offline local");
            setupDetailDescription.setText(
                "Toque na TV as músicas já baixadas no celular, mesmo sem Internet ou servidor."
            );
            setSetupStatus(
                SETUP_ACCENT_BRIGHT,
                "Não depende do servidor",
                "Celular e BTV precisam estar na mesma rede local"
            );
            return;
        }

        if (action == SETUP_SERVER) {
            setupDetailLabel.setText("CONFIGURAÇÃO");
            setupDetailTitle.setText("Alterar servidor");
            setupDetailDescription.setText(
                "Configure o endereço usado pelo Home Music TV quando o servidor mudar."
            );
            setSetupStatus(
                SETUP_ACCENT_BRIGHT,
                "Servidor atual",
                displayServerAddress(currentAddress)
            );
            return;
        }

        if (action == SETUP_SHORTCUT) {
            setupDetailLabel.setText("ACESSO RÁPIDO");
            setupDetailTitle.setText("Adicionar à tela inicial");
            setupDetailDescription.setText(
                "Peça ao launcher do BTV para criar um atalho direto para o Home Music."
            );
            setSetupStatus(
                SETUP_ACCENT_BRIGHT,
                "Atalho do BTV",
                "A disponibilidade depende do launcher instalado"
            );
            return;
        }

        setupDetailLabel.setText("HOME MUSIC TV");
        setupDetailTitle.setText("Abrir Home Music");
        setupDetailDescription.setText(
            "Entre na sua biblioteca e continue ouvindo normalmente."
        );
        if (!setupServerReachabilityKnown) {
            setSetupStatus(
                SETUP_ACCENT_BRIGHT,
                "Verificando servidor",
                displayServerAddress(currentAddress)
            );
        } else if (setupServerReachable) {
            setSetupStatus(
                SETUP_SUCCESS,
                "Servidor conectado",
                displayServerAddress(currentAddress)
            );
        } else {
            setSetupStatus(
                SETUP_DANGER,
                "Servidor indisponível",
                displayServerAddress(currentAddress)
            );
        }
    }

    private void setSetupStatus(int color, String title, String detail) {
        setupStatusDot.setBackground(setupStatusDotBackground(color));
        setupStatusTitle.setText(title);
        setupStatusDetail.setText(detail);
    }

    private void openConfiguredServer() {
        String normalized = normalizeAddress(currentAddress);
        if (normalized == null) {
            showServerAddressDialog();
            return;
        }
        preferences.edit().putString(KEY_URL, normalized).apply();
        showBrowser(normalized);
    }

    private void showServerAddressDialog() {
        final EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setText(hasText(currentAddress) ? currentAddress : DEFAULT_URL);
        address.setHint(DEFAULT_URL);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setTextSize(18);
        address.setSelectAllOnFocus(false);

        FrameLayout wrapper = new FrameLayout(this);
        wrapper.setPadding(dp(24), dp(4), dp(24), 0);
        wrapper.addView(address, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        ));

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Alterar servidor")
            .setMessage("Informe o endereço http:// ou https:// usado pelo Home Music TV.")
            .setView(wrapper)
            .setPositiveButton("Salvar", null)
            .setNegativeButton("Cancelar", null)
            .create();

        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String nextAddress = normalizeAddress(address.getText().toString());
            if (nextAddress == null) {
                address.setError("Informe um endereço http:// ou https:// válido.");
                address.requestFocus();
                return;
            }
            preferences.edit().putString(KEY_URL, nextAddress).apply();
            currentAddress = nextAddress;
            dialog.dismiss();
            showSetup(nextAddress);
        }));
        dialog.show();
        address.requestFocus();
    }

    private void checkSetupServerReachability(String address) {
        final String checkedAddress = address;
        new Thread(() -> {
            boolean reachable = false;
            HttpURLConnection connection = null;
            try {
                URL url = new URL(checkedAddress);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(2500);
                connection.setUseCaches(false);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestMethod("HEAD");
                int status = connection.getResponseCode();
                reachable = status >= 100 && status <= 599;
            } catch (Exception ignored) {
                reachable = false;
            } finally {
                if (connection != null) connection.disconnect();
            }

            final boolean serverReachable = reachable;
            runOnUiThread(() -> {
                if (!showingSetup || !checkedAddress.equals(currentAddress)) return;
                setupServerReachabilityKnown = true;
                setupServerReachable = serverReachable;
                if (setupFocusedAction == SETUP_OPEN) renderSetupDetails(SETUP_OPEN);
            });
        }, "home-music-tv-server-check").start();
    }

    private static String displayServerAddress(String address) {
        if (!hasText(address)) return "";
        Uri uri = Uri.parse(address);
        if (!hasText(uri.getAuthority())) return address;
        String path = uri.getPath();
        if (!hasText(path) || "/".equals(path)) return uri.getAuthority();
        return uri.getAuthority() + path;
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
