# TLS certificates

Place the production certificate and private key in this directory before starting `docker-compose.prod.yml`:

- `tls.crt` — server certificate, preferably including the intermediate chain;
- `tls.key` — corresponding private key.

Do **not** commit production certificates or private keys to Git.

For an internal PKI, issue the certificate for the exact value used in `SERVER_NAME`.
If TLS is terminated by an existing corporate ingress/reverse proxy, this nginx container can be omitted and the `app:8000` service can be proxied by that infrastructure instead.
