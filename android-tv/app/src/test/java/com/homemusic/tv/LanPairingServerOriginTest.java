package com.homemusic.tv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class LanPairingServerOriginTest {
    private static final String HOME_MUSIC_ORIGIN = "https://home-music.tail6ab100.ts.net";
    private static final String TV_HOST = "192.168.1.44:41234";

    @Test
    public void acceptsTheBridgeSameOriginRequest() {
        assertTrue(LanPairingServer.originAllowedForRequest(
            "http://" + TV_HOST,
            false,
            HOME_MUSIC_ORIGIN,
            TV_HOST
        ));
    }

    @Test
    public void rejectsAnotherLanWebOrigin() {
        assertFalse(LanPairingServer.originAllowedForRequest(
            "http://192.168.1.99:8080",
            false,
            HOME_MUSIC_ORIGIN,
            TV_HOST
        ));
    }

    @Test
    public void keepsConfiguredHomeMusicOriginAllowed() {
        assertTrue(LanPairingServer.originAllowedForRequest(
            HOME_MUSIC_ORIGIN,
            false,
            HOME_MUSIC_ORIGIN,
            TV_HOST
        ));
    }
}
