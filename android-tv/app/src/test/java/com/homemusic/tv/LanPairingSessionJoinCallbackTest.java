package com.homemusic.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.lang.reflect.Constructor;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;

public final class LanPairingSessionJoinCallbackTest {
    private static final class FakeClock implements LanPairingSession.Clock {
        long now = 1_800_000_000_000L;

        @Override
        public long now() {
            return now;
        }
    }

    @Test
    public void successfulJoinNotifiesReceiverStartupExactlyOnce() throws Exception {
        Constructor<?> callbackConstructor = Arrays.stream(LanPairingSession.class.getDeclaredConstructors())
            .filter(constructor -> constructor.getParameterCount() == 3)
            .filter(constructor -> constructor.getParameterTypes()[0] == SecureRandom.class)
            .filter(constructor -> constructor.getParameterTypes()[1] == LanPairingSession.Clock.class)
            .filter(constructor -> constructor.getParameterTypes()[2] == Runnable.class)
            .findFirst()
            .orElse(null);

        assertNotNull("LanPairingSession precisa notificar o join autenticado", callbackConstructor);
        callbackConstructor.setAccessible(true);

        FakeClock clock = new FakeClock();
        AtomicInteger notifications = new AtomicInteger();
        LanPairingSession session = (LanPairingSession) callbackConstructor.newInstance(
            new SecureRandom(),
            clock,
            (Runnable) notifications::incrementAndGet
        );

        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_auto_receiver_123");
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
        assertNull(session.join(challenge.clientNonce, challenge.tvNonce, challenge.expiresAt, proof));
        assertEquals(1, notifications.get());
    }
}
