#!/usr/bin/env node
// Helper script to generate password hashes for AUTH_USERS environment variable

const crypto = require('crypto');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const password = process.argv[2];

if (!password) {
    console.log('Usage: node scripts/hash-password.js <password>');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/hash-password.js mypassword123');
    console.log('');
    console.log('This will output a hash that you can use in your AUTH_USERS environment variable.');
    process.exit(1);
}

const hash = hashPassword(password);

console.log('');
console.log('Password:', password);
console.log('Hash:', hash);
console.log('');
console.log('Add this to your Netlify environment variables (Site settings → Environment variables):');
console.log('');
console.log('Variable name: AUTH_USERS');
console.log('Value format: email:hash:role:studentId');
console.log('');
console.log('Examples:');
console.log(`  admin@example.com:${hash}:admin`);
console.log(`  student@example.com:${hash}:student:recStudentId123`);
console.log('');
console.log('Multiple users (comma-separated):');
console.log(`  admin@example.com:${hash}:admin,student@example.com:${hash}:student:recXXX`);
console.log('');
