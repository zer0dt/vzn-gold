/**
 * Client-side AIP (Author Identity Protocol) signing utility.
 * Signs content with the user's owner key to prove authorship.
 */

import { PrivateKey, BSM } from '@bsv/sdk';

// Protocol addresses
const B_PROTOCOL_ADDRESS = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut';
const MAP_PROTOCOL_ADDRESS = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5';
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'VZN.gold';

// Helper to convert string to hex
function stringToHex(str: string): string {
    return Buffer.from(str, 'utf8').toString('hex');
}

export interface AIPSignatureData {
    signature: string;  // Base64 encoded signature
    address: string;    // User's owner address (signing address)
}

/**
 * Generate the BSocial payload ops array for a post or reply
 */
function getBSocialOps(content: string, appName: string, replyToTxid?: string): string[] {
    const ops: string[] = [];

    // Add B protocol content
    ops.push(B_PROTOCOL_ADDRESS);
    ops.push(content);
    ops.push('text/markdown');
    ops.push('UTF-8');
    ops.push('|');

    // Add MAP protocol metadata
    ops.push(MAP_PROTOCOL_ADDRESS);
    ops.push('SET');
    ops.push('app');
    ops.push(appName);
    ops.push('type');
    ops.push('post');

    // Add reply context if this is a reply
    if (replyToTxid) {
        ops.push('context');
        ops.push('tx');
        ops.push('tx');
        ops.push(replyToTxid);
    }

    return ops;
}

/**
 * Sign content with the user's owner key for AIP protocol.
 * This proves the user authored the content.
 * 
 * @param content - The post/reply content
 * @param ownerKeyWif - The user's owner key in WIF format
 * @param replyToTxid - Optional txid if this is a reply
 * @returns AIP signature data (signature + address) or null if signing fails
 */
export function signWithAIP(
    content: string,
    ownerKeyWif: string,
    replyToTxid?: string
): AIPSignatureData | null {
    try {
        // Create private key from WIF
        const privateKey = PrivateKey.fromWif(ownerKeyWif);
        const address = privateKey.toAddress();

        // Get BSocial ops
        const ops = getBSocialOps(content, APP_NAME, replyToTxid);

        // Build the data to sign (hex representation of all ops)
        const hexParts = ['6a']; // OP_RETURN
        ops.forEach(o => {
            hexParts.push(stringToHex(o));
        });

        // Create message to sign from hex data
        const messageToSign = Buffer.from(hexParts.join(''), 'hex');

        // Sign using BSM (Bitcoin Signed Message) - returns base64 string
        const signatureBase64 = BSM.sign(Array.from(messageToSign), privateKey, 'base64') as string;

        return {
            signature: signatureBase64,
            address: address
        };
    } catch (error) {
        console.error('Error signing with AIP:', error);
        return null;
    }
}

/**
 * Get the user's owner key from sessionStorage
 */
export function getOwnerKey(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('ownerKey');
}
