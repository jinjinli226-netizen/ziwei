#include <arpa/inet.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Darwin interposing also affects dlsym results. A raw bind avoids recursively re-entering this shim. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static int original_bind(int fd, const struct sockaddr *address, socklen_t length) {
    return (int)syscall(SYS_bind, fd, address, length);
}
#pragma clang diagnostic pop

/* Gradle chooses ephemeral listener ports internally. Mac builds may bind only this pre-registered pool. */
static int registered_bind(int fd, const struct sockaddr *address, socklen_t length) {
    int kind = 0; socklen_t kind_length = sizeof(kind);
    if (!address || length > sizeof(struct sockaddr_storage)
        || getsockopt(fd, SOL_SOCKET, SO_TYPE, &kind, &kind_length) != 0)
        return original_bind(fd, address, length);
    int ephemeral = (address->sa_family == AF_INET && ((const struct sockaddr_in *)address)->sin_port == 0)
        || (address->sa_family == AF_INET6 && ((const struct sockaddr_in6 *)address)->sin6_port == 0);
    if (!ephemeral || (kind != SOCK_STREAM && kind != SOCK_DGRAM)) return original_bind(fd, address, length);
    const char *pool = getenv(kind == SOCK_STREAM ? "ZIWEI_GRADLE_TCP_PORTS" : "ZIWEI_GRADLE_UDP_PORTS");
    if (!pool || !*pool) { errno = EACCES; return -1; }
    char *copy = strdup(pool), *cursor = NULL;
    if (!copy) { errno = ENOMEM; return -1; }
    int result = -1, saved = EADDRINUSE;
    for (char *part = strtok_r(copy, ",", &cursor); part; part = strtok_r(NULL, ",", &cursor)) {
        int port = atoi(part); if (port < 1 || port > 65535) continue;
        struct sockaddr_storage adjusted; memset(&adjusted, 0, sizeof(adjusted)); memcpy(&adjusted, address, length);
        if (address->sa_family == AF_INET) {
            struct sockaddr_in *value = (struct sockaddr_in *)&adjusted;
            value->sin_port = htons((unsigned short)port);
            if (value->sin_addr.s_addr == htonl(INADDR_ANY)) value->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        } else {
            struct sockaddr_in6 *value = (struct sockaddr_in6 *)&adjusted;
            value->sin6_port = htons((unsigned short)port);
            if (IN6_IS_ADDR_UNSPECIFIED(&value->sin6_addr)) {
                memset(&value->sin6_addr, 0, sizeof(value->sin6_addr));
                value->sin6_addr.s6_addr[10] = 0xff; value->sin6_addr.s6_addr[11] = 0xff;
                value->sin6_addr.s6_addr[12] = 127; value->sin6_addr.s6_addr[15] = 1;
            }
        }
        result = original_bind(fd, (struct sockaddr *)&adjusted, length);
        if (result == 0) break;
        saved = errno; if (saved != EADDRINUSE) break;
    }
    free(copy); if (result != 0) errno = saved; return result;
}
__attribute__((used)) static struct { const void *replacement; const void *original; }
interpose_bind __attribute__((section("__DATA,__interpose"))) = { (const void *)&registered_bind, (const void *)&bind };
