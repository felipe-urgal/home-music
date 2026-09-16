package com.homemusic.tv;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

final class LanAddressResolver {
    private LanAddressResolver() {}

    static String resolve() throws SocketException {
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        if (interfaces == null) return null;
        List<NetworkInterface> networks = Collections.list(interfaces);
        networks.sort(Comparator.comparingInt(network -> interfacePriority(network.getName())));
        for (NetworkInterface network : networks) {
            if (!network.isUp() || network.isLoopback() || network.isVirtual() || network.isPointToPoint()) continue;
            if (interfacePriority(network.getName()) >= 100) continue;
            String selected = selectAddress(Collections.list(network.getInetAddresses()));
            if (selected != null) return selected;
        }
        return null;
    }

    static int interfacePriority(String name) {
        String value = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (value.startsWith("wlan") || value.contains("wifi")) return 0;
        if (value.startsWith("eth") || value.startsWith("en")) return 1;
        if (value.startsWith("tun") || value.startsWith("tap") || value.startsWith("ppp")
            || value.startsWith("rmnet") || value.startsWith("ccmni") || value.startsWith("clat")
            || value.startsWith("v4-") || value.startsWith("dummy")) return 100;
        return 10;
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
