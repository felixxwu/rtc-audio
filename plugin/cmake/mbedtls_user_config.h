// Extra mbedTLS options needed by libdatachannel, layered on top of mbedTLS's
// default config. libdatachannel's DTLS transport calls the DTLS-SRTP
// profile API unconditionally (even with RTC_ENABLE_MEDIA=0), and mbedTLS
// ships that feature disabled.
#define MBEDTLS_SSL_DTLS_SRTP
