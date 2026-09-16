package com.homemusic.tv;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

final class LanAddressResolver {
    private LanAddressResolver() {}

    static String resolve() throws SocketException {
        List<InetAddress> addresses = new ArrayList<>();
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        if (interfaces == null) return null;
        for (NetworkInterface network : Collections.list(interfaces)) {
            if (!network.isUp() || network.isLoopback()) continue;
            addresses.addAll(Collections.list(network.getInetAddresses()));
        }
        return selectAddress(addresses);
    }

    static String selectAddress(List<InetAddress> addresses) {
        for (InetAddress address : addresses) {
            if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
            String host = address.getHostAddress();
            if (isPrivateIpv4(host)) return host;
        }
        return null;
    }

    static boolean isPrivateIpv4(String host) {
        if (host == null) return false;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] values = new int[4];
        for (int index = 0; index < 4; index += 1) {
            try {
                if (parts[index].isEmpty() || (parts[index].length() > 1 && parts[index].startsWith("0"))) return false;
                values[index] = Integer.parseInt(parts[index]);
            } catch (NumberFormatException error) {
                return false;
            }
            if (values[index] < 0 || values[index] > 255) return false;
        }
        return values[0] == 10
            || (values[0] == 172 && values[1] >= 16 && values[1] <= 31)
            || (values[0] == 192 && values[1] == 168);
    }
}
