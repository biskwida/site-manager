<?php
// Smoke-test only (mounted by docker-compose.yml, never shipped): lets WordPress download from the host machine.
declare(strict_types=1);
add_filter('http_request_host_is_external', static fn(bool $external, string $host): bool => $host === 'host.docker.internal' ? true : $external, 10, 2);
