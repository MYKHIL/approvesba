// ==================== OFFLINE ACTIVATION MODE ====================

let activationMode = 'online'; // 'online' or 'offline'
let offlineTokenData = null;

// Crypto Constants
const BASE_KEY_STRING = "SBAProMasterSecretKey2023!@#$%^&*()";
const BASE_IV_STRING = "SBAProIV20231234!";

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api';

// Product Versions (matching C# enum)
const PRODUCT_VERSIONS = ['Trial', 'Basic', 'Standard', 'Premium', 'Professional', 'Enterprise', 'Full'];

// Utility: Convert string to Uint8Array
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return bufView;
}

// Utility: SHA-256 hash
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Triple SHA-256 hash (for password validation)
async function tripleSha256(password) {
    let hash = password;
    for (let i = 0; i < 3; i++) {
        hash = await sha256(hash);
    }
    return hash;
}

// Calculate fixed-length hash (first 8 chars of SHA-256)
async function calculateFixedLengthHash(input) {
    const hash = await sha256(input);
    return hash.substring(0, 8);
}

// Convert from alphanumeric (Base64 with length prefix)
function convertFromAlphanumeric(alphanumericString) {
    if (!alphanumericString) return '';

    try {
        const resultBytes = Uint8Array.from(atob(alphanumericString), c => c.charCodeAt(0));
        const dataView = new DataView(resultBytes.buffer);
        const originalStringLength = dataView.getInt32(0, true); // Little-endian

        const decoder = new TextDecoder('utf-8');
        return decoder.decode(resultBytes.slice(4, 4 + originalStringLength));
    } catch (e) {
        console.error('Alphanumeric decode error:', e);
        return '';
    }
}

// AES-256-CBC Decrypt with BASE_KEY and BASE_IV
async function aesDecrypt(encryptedData, keyStr = BASE_KEY_STRING, ivStr = BASE_IV_STRING) {
    try {
        // Prepare key (32 bytes)
        const keyBytes = new Uint8Array(32);
        const keySource = str2ab(keyStr);
        keyBytes.set(keySource.slice(0, Math.min(keySource.length, 32)));

        // Prepare IV (16 bytes)
        const ivBytes = new Uint8Array(16);
        const ivSource = str2ab(ivStr);
        ivBytes.set(ivSource.slice(0, Math.min(ivSource.length, 16)));

        const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-CBC' },
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: ivBytes },
            key,
            encryptedData
        );

        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('Decryption error:', e);
        throw new Error('Failed to decrypt data');
    }
}

// AES-256-CBC Encrypt with BASE_KEY and BASE_IV
async function aesEncrypt(plaintext, keyStr = BASE_KEY_STRING, ivStr = BASE_IV_STRING) {
    try {
        // Prepare key (32 bytes)
        const keyBytes = new Uint8Array(32);
        const keySource = str2ab(keyStr);
        keyBytes.set(keySource.slice(0, Math.min(keySource.length, 32)));

        // Prepare IV (16 bytes)
        const ivBytes = new Uint8Array(16);
        const ivSource = str2ab(ivStr);
        ivBytes.set(ivSource.slice(0, Math.min(ivSource.length, 16)));

        const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-CBC' },
            false,
            ['encrypt']
        );

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-CBC', iv: ivBytes },
            key,
            new TextEncoder().encode(plaintext)
        );

        return new Uint8Array(encrypted);
    } catch (e) {
        console.error('Encryption error:', e);
        throw new Error('Failed to encrypt data');
    }
}

// Encrypt expiry date using MAC-derived key
async function encryptExpiryDate(expiryDate, macAddress) {
    try {
        // Derive key from MAC address (SHA-256)
        const macHash = await sha256(macAddress);
        const macHashBytes = new Uint8Array(macHash.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        // Use first 32 bytes as key
        const keyBytes = new Uint8Array(32);
        keyBytes.set(macHashBytes.slice(0, 32));

        // IMPORTANT: Use all-zeros IV (matching WPF LicenseManager)
        const ivBytes = new Uint8Array(16); // All zeros

        const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-CBC' },
            false,
            ['encrypt']
        );

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-CBC', iv: ivBytes },
            key,
            new TextEncoder().encode(expiryDate)
        );

        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    } catch (e) {
        console.error('Expiry encryption error:', e);
        throw new Error('Failed to encrypt expiry date');
    }
}

// Generate license key
async function generateLicenseKey(macAddress, version, expiryDate) {
    const hashedMac = await calculateFixedLengthHash(macAddress);
    const hashedVersion = await calculateFixedLengthHash(version);
    const encryptedExpiry = await encryptExpiryDate(expiryDate, macAddress);

    return `${hashedMac}-${hashedVersion}-${encryptedExpiry}`;
}

// Create license token
async function createLicenseToken(licenseKey, expiryDate, version, productId) {
    const tokenData = `${licenseKey}|${expiryDate}|${version}|${productId}`;
    const encrypted = await aesEncrypt(tokenData);
    // Return Base64-encoded encrypted data (WPF expects this)
    return btoa(String.fromCharCode(...encrypted));
}

// Create user token (.slic file)
async function createUserToken(username, licenseTokenBase64) {
    // licenseTokenBase64 is already a Base64 string from createLicenseToken
    const tokenData = `${username}|${licenseTokenBase64}`;
    return await aesEncrypt(tokenData);
}

// Switch activation mode
function switchMode(mode) {
    activationMode = mode;
    document.getElementById('onlineToggle').classList.toggle('bg-blue-600', mode === 'online');
    document.getElementById('onlineToggle').classList.toggle('text-white', mode === 'online');
    document.getElementById('onlineToggle').classList.toggle('bg-gray-100', mode !== 'online');
    document.getElementById('onlineToggle').classList.toggle('text-gray-600', mode !== 'online');

    document.getElementById('offlineToggle').classList.toggle('bg-blue-600', mode === 'offline');
    document.getElementById('offlineToggle').classList.toggle('text-white', mode === 'offline');
    document.getElementById('offlineToggle').classList.toggle('bg-gray-100', mode !== 'offline');
    document.getElementById('offlineToggle').classList.toggle('text-gray-600', mode !== 'offline');

    // Show/hide appropriate panels
    document.getElementById('onlinePanel').classList.toggle('hidden', mode !== 'online');
    document.getElementById('offlinePanel').classList.toggle('hidden', mode !== 'offline');
}

// Handle file drop/upload for offline mode
async function handleTokenFile(file) {
    if (!file || !file.name.endsWith('.token')) {
        alert('Please select a valid .token file');
        return;
    }

    try {
        if (window.showLoadingOverlay) window.showLoadingOverlay('Reading Token...', true);
        else document.getElementById('loadingOverlay').classList.remove('hidden');
        const arrayBuffer = await file.arrayBuffer();
        const decrypted = await aesDecrypt(new Uint8Array(arrayBuffer));

        // Parse: UserName|Phone|TransID|ProdID|Remaining
        const parts = decrypted.split('|');
        if (parts.length !== 5) {
            throw new Error('Invalid token file format');
        }

        offlineTokenData = {
            userName: parts[0],
            phone: parts[1],
            transId: parts[2],
            prodId: parts[3],
            remaining: parts[4],
            macAddress: convertFromAlphanumeric(parts[3])
        };

        // Populate fields
        document.getElementById('offlineUserName').value = offlineTokenData.userName;
        document.getElementById('offlinePhone').value = offlineTokenData.phone;
        document.getElementById('offlineTransId').value = offlineTokenData.transId;
        document.getElementById('offlineProdId').value = offlineTokenData.prodId;
        document.getElementById('offlineRemaining').value = offlineTokenData.remaining;

        // Update drop zone
        document.getElementById('dropZoneText').textContent = `✅ ${file.name}`;
        document.getElementById('offlineFieldsContainer').classList.remove('hidden');

        alert('✅ Token file loaded successfully!');
    } catch (e) {
        console.error('File processing error:', e);
        alert(`Error reading token file: ${e.message}`);
    } finally {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }
}

// File input change handler
function onTokenFileSelected(event) {
    const file = event.target.files[0];
    if (file) handleTokenFile(file);
}

// Drag and drop handlers
function setupDropZone() {
    const dropZone = document.getElementById('tokenDropZone');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');

        const file = e.dataTransfer.files[0];
        if (file) handleTokenFile(file);
    });
}

// Generate offline license
async function generateOfflineLicense() {
    if (!offlineTokenData) {
        alert('Please upload a .token file first');
        return;
    }

    const password = document.getElementById('offlinePassword').value;
    const requested = parseInt(document.getElementById('offlineRequested').value) || 0;
    const versionIndex = document.getElementById('offlineRegType').selectedIndex;

    if (!password) {
        alert('❌ Please enter the master password');
        return;
    }

    if (requested <= 0) {
        alert('❌ Please enter requested days');
        return;
    }

    try {
        document.getElementById('loadingOverlay').classList.remove('hidden');

        // Validate password via API
        const response = await fetch(`${API_BASE_URL}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const result = await response.json();
        if (!result.success) {
            alert(`❌ ${result.message || 'Invalid master password!'}`);
            return;
        }

        // Calculate expiry date
        const remaining = parseInt(offlineTokenData.remaining) || 0;
        const totalDays = remaining + requested;
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + totalDays);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];

        const version = PRODUCT_VERSIONS[versionIndex];

        // Generate license key
        const licenseKey = await generateLicenseKey(
            offlineTokenData.macAddress,
            version,
            expiryDateStr
        );

        // Create license token
        const licenseToken = await createLicenseToken(
            licenseKey,
            expiryDateStr,
            version,
            offlineTokenData.prodId
        );

        // Create user token (.slic file)
        const userToken = await createUserToken(offlineTokenData.userName, licenseToken);

        // Download the file
        const blob = new Blob([userToken], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${offlineTokenData.userName}_license.slic`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert(`✅ License generated successfully!\n\nLicense Key: ${licenseKey}\nExpiry Date: ${expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n\nFile downloaded: ${offlineTokenData.userName}_license.slic`);
    } catch (e) {
        console.error('License generation error:', e);
        alert(`❌ Error generating license: ${e.message}`);
    } finally {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setupDropZone();
});
