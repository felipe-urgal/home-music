package com.homemusic.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.res.AssetManager;

import org.junit.Test;

import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicInteger;

public final class LanPairingServerAutoReceiverTest {
    @Test
    public void authenticatedJoinNotifiesServerListenerExactlyOnce() throws Exception {
        AtomicInteger notifications = new AtomicInteger();
        LanPairingServer server = new LanPairingServer(
            "https://home-music.example",
            (AssetManager) null,
            joinedServer -> notifications.incrementAndGet()
        );

        Field sessionField = LanPairingServer.class.getDeclaredField("pairingSession");
        sessionField.setAccessible(true);
        LanPairingSession session = (LanPairingSession) sessionField.get(server);

        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_auto_receiver_server_123");
        assertNotNull(challenge);
        String proof = LanPairingSession.computeProof(secret, challenge);

        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            proof
        );

        assertNotNull(joined);
        assertEquals(1, notifications.get());
        session.join(challenge.clientNonce, challenge.tvNonce, challenge.expiresAt, proof);
        assertEquals(1, notifications.get());
        server.close();
    }
}
