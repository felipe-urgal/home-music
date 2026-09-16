package com.homemusic.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.net.InetAddress;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;

public final class LanPairingSessionTest {
    private static final class FakeClock implements LanPairingSession.Clock {
        long now = 1_800_000_000_000L;

        @Override
        public long now() {
            return now;
        }
    }

    @Test
    public void challengeProofIsSingleUseAndProducesScopedRemoteToken() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_1234567890");
        assertNotNull(challenge);

        String proof = LanPairingSession.computeProof(secret, challenge);
        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            proof
        );
        assertNotNull(joined);
        assertNull(session.pairingSecret());
        assertTrue(session.authorize("remote", joined.sessionToken));
        assertTrue(session.authorize("tv", session.receiverToken()));
        assertFalse(session.authorize("tv", joined.sessionToken));
        assertNull(session.join(challenge.clientNonce, challenge.tvNonce, challenge.expiresAt, proof));
    }

    @Test
    public void establishedSessionKeepsReceiverBootstrapAliveBeyondPairingTtl() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_receiver_123");
        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            LanPairingSession.computeProof(secret, challenge)
        );

        assertNotNull(joined);
        assertEquals(joined.expiresAt, session.receiverExpiresAt());
        clock.now += LanPairingSession.PAIRING_TTL_MS + 1;
        assertFalse(session.isClosed());
        assertEquals(joined.expiresAt, session.receiverExpiresAt());
    }

    @Test
    public void invalidProofConsumesChallengeAndExpiredPairingClosesSession() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_abcdefghij");
        assertNotNull(challenge);
        assertNull(session.join(challenge.clientNonce, challenge.tvNonce, challenge.expiresAt, "00"));
        assertNull(session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            LanPairingSession.computeProof(session.pairingSecret(), challenge)
        ));

        clock.now += LanPairingSession.PAIRING_TTL_MS + 1;
        assertTrue(session.isClosed());
        assertNull(session.createChallenge("client_nonce_other_12345"));
    }

    @Test
    public void replayedSignalIdsAreRejectedAndMailboxIsRoleScoped() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_signal_1234");
        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            LanPairingSession.computeProof(secret, challenge)
        );
        assertNotNull(joined);

        String id = "message_signal_1234567890";
        assertTrue(session.publish("remote", joined.sessionToken, id, "{\"from\":\"remote\"}"));
        assertFalse(session.publish("remote", joined.sessionToken, id, "{\"from\":\"remote\"}"));
        assertEquals(1, session.poll("tv", session.receiverToken(), 0).size());
        assertEquals(0, session.poll("remote", joined.sessionToken, 0).size());
        assertEquals(1L, session.latestSequence());
    }

    @Test
    public void mailboxIsBounded() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_bound_12345");
        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            LanPairingSession.computeProof(secret, challenge)
        );
        for (int index = 0; index < LanPairingSession.MAX_PENDING_SIGNALS + 5; index += 1) {
            assertTrue(session.publish(
                "remote",
                joined.sessionToken,
                String.format("message_%016d", index),
                "{}"
            ));
        }
        assertEquals(LanPairingSession.MAX_PENDING_SIGNALS, session.poll("tv", session.receiverToken(), 0).size());
    }

    @Test
    public void requestAuthorizationMatchesWebClientVector() {
        LanPairingSession.Challenge vectorChallenge = new LanPairingSession.Challenge(
            "session_1234567890abcdef",
            "client_1234567890abcdef",
            "tvnonce_1234567890abcdef",
            1_800_000_030_000L
        );
        LanPairingSession.JoinResult vectorSession = new LanPairingSession.JoinResult(
            "token_1234567890abcdef1234567890abcdef",
            1_800_000_120_000L
        );
        String body = "{\"messageId\":\"message_1234567890abcdef\",\"from\":\"remote\",\"signal\":{\"from\":\"remote\",\"type\":\"description\",\"description\":{\"type\":\"offer\",\"sdp\":\"v=0\\r\\n\"}}}";

        assertEquals(
            "HomeMusic token_1234567890abcdef1234567890abcdef.1800000000000.request_1234567890abcdef.I8zKt0Vy5QC006hebmXRWDRLMiVZmzf8xhibdqTxSGY",
            LanPairingSession.computeRequestAuthorization(
                "0123456789abcdef0123456789abcdef",
                vectorChallenge,
                vectorSession,
                "POST",
                "/signals?role=remote",
                body.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                1_800_000_000_000L,
                "request_1234567890abcdef"
            )
        );
    }

    @Test
    public void remoteRequestSignatureRejectsBearerTamperingAndReplay() {
        FakeClock clock = new FakeClock();
        LanPairingSession session = new LanPairingSession(new SecureRandom(), clock);
        String secret = session.pairingSecret();
        LanPairingSession.Challenge challenge = session.createChallenge("client_nonce_request_1234");
        LanPairingSession.JoinResult joined = session.join(
            challenge.clientNonce,
            challenge.tvNonce,
            challenge.expiresAt,
            LanPairingSession.computeProof(secret, challenge)
        );
        assertNotNull(joined);

        String target = "/signals?role=remote";
        byte[] body = "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String authorization = LanPairingSession.computeRequestAuthorization(
            secret,
            challenge,
            joined,
            "POST",
            target,
            body,
            clock.now,
            "request_nonce_1234567890"
        );

        assertFalse(session.authorizeRemoteRequest(
            "Bearer " + joined.sessionToken,
            "POST",
            target,
            body
        ));
        assertTrue(session.authorizeRemoteRequest(authorization, "POST", target, body));
        assertFalse(session.authorizeRemoteRequest(authorization, "POST", target, body));

        String tampered = LanPairingSession.computeRequestAuthorization(
            secret,
            challenge,
            joined,
            "POST",
            target,
            body,
            clock.now,
            "request_nonce_abcdefghijk"
        );
        assertFalse(session.authorizeRemoteRequest(tampered, "POST", target + "&cursor=1", body));
    }

    @Test
    public void addressResolverSelectsOnlyRfc1918Ipv4AndPrioritizesLanInterfaces() throws Exception {
        List<InetAddress> addresses = Arrays.asList(
            InetAddress.getByName("8.8.8.8"),
            InetAddress.getByName("2001:db8::1"),
            InetAddress.getByName("192.168.50.12")
        );
        assertEquals("192.168.50.12", LanAddressResolver.selectAddress(addresses));
        assertTrue(LanAddressResolver.isPrivateIpv4("10.0.0.5"));
        assertTrue(LanAddressResolver.isPrivateIpv4("172.31.1.5"));
        assertFalse(LanAddressResolver.isPrivateIpv4("172.32.1.5"));
        assertFalse(LanAddressResolver.isPrivateIpv4("192.168.01.5"));
        assertTrue(LanAddressResolver.interfacePriority("wlan0") < LanAddressResolver.interfacePriority("rmnet_data0"));
        assertTrue(LanAddressResolver.interfacePriority("eth0") < LanAddressResolver.interfacePriority("tun0"));
    }
}
