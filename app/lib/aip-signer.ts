/**
 * Client-side AIP (Author Identity Protocol) signing utility.
 * Signs content with the user's owner key to prove authorship.
 */

import { PrivateKey, BSM } from '@bsv/sdk';
import {
    buildAIPMessageBytes,
    buildUnsignedBSocialOutputs,
    DEFAULT_APP_NAME,
    type BSocialImagePayload,
    type BSocialPostType,
} from '@/app/lib/bsocial-payload';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || DEFAULT_APP_NAME;

export interface AIPSignatureData {
    signature: string;  // Base64 encoded signature
    address: string;    // User's owner address (signing address)
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
    replyToTxid?: string,
    image?: BSocialImagePayload,
    type: BSocialPostType = replyToTxid ? 'reply' : 'post'
): AIPSignatureData | null {
    try {
        // Create private key from WIF
        const privateKey = PrivateKey.fromWif(ownerKeyWif);
        const address = privateKey.toAddress();

        const outputs = buildUnsignedBSocialOutputs({
            content,
            appName: APP_NAME,
            type,
            replyToTxid,
            image,
        });

        if (outputs.length === 0) {
            return null;
        }

        // Sign using BSM (Bitcoin Signed Message) - returns base64 string
        const signatureBase64 = BSM.sign(buildAIPMessageBytes(outputs), privateKey, 'base64') as string;

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
