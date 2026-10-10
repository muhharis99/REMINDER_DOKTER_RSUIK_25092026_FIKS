<?php
/**
 * Copy to config.local.php and replace placeholders.
 * config.local.php is ignored by Git and must never be committed.
 */
return [
    'databases' => [
        'local' => ['host' => '127.0.0.1', 'port' => 3306, 'user' => 'CHANGE_ME', 'pass' => 'CHANGE_ME', 'name' => 'dokter_reminder'],
        'rsiklaten' => ['host' => 'CHANGE_ME', 'port' => 3306, 'user' => 'CHANGE_ME', 'pass' => 'CHANGE_ME', 'name' => 'CHANGE_ME'],
        'rsi_byl' => ['host' => 'CHANGE_ME', 'port' => 3306, 'user' => 'CHANGE_ME', 'pass' => 'CHANGE_ME', 'name' => 'CHANGE_ME'],
        'rme' => ['host' => 'CHANGE_ME', 'port' => 3306, 'user' => 'CHANGE_ME', 'pass' => 'CHANGE_ME', 'name' => 'CHANGE_ME'],
    ],
    'wa_gateway' => [
        'internal_url' => 'http://127.0.0.1:3210',
        'api_token' => 'CHANGE_ME_LONG_RANDOM_TOKEN',
        'callback_token' => 'CHANGE_ME_DIFFERENT_LONG_RANDOM_TOKEN',
    ],
];
