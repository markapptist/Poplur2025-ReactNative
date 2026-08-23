import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import {
  finishTransaction,
  getProducts,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  setup as setupIap,
  PurchaseStateAndroid,
  type Product,
  type Purchase,
} from 'react-native-iap';
import type { PurchaseError } from 'react-native-iap';
import { auth, functions } from './firebase';

// Poplur Cards (consumable credits) checkout. iOS uses StoreKit2, Android
// uses Play Billing; both are already shipped native (see
// PoplurCardPurchaseService.swift / PoplurBillingManager.kt). This is RN's
// bridge for the SAME `poplurStoreCheckoutRequested` -> `verifyCardPurchase`
// -> `poplurStoreCheckoutResult` contract the web page (HomeTwin.tsx) already
// speaks to both native shells. Keep this file's request/result shapes in
// sync with those two if the contract ever changes.

// cardId -> platform product ID. HomeTwin.tsx already validates the bag
// against the identical maps before it ever posts to native, so this is a
// defensive re-check (matching what both native handlers do), not the
// primary gate.
const IOS_PRODUCT_BY_CARD_ID: Record<string, string> = {
  inverted: 'com.apptist.Poplur2025.card.inverted',
  lens: 'com.apptist.Poplur2025.card.lens',
  splitDiamond: 'com.apptist.Poplur2025.card.splitdiamond',
  swoosh: 'com.apptist.Poplur2025.card.swoosh',
};

const ANDROID_PRODUCT_BY_CARD_ID: Record<string, string> = {
  inverted: 'com.apptists.poplur2025.card.inverted',
  lens: 'com.apptists.poplur2025.card.lens',
  splitDiamond: 'com.apptists.poplur2025.card.splitdiamond',
  swoosh: 'com.apptists.poplur2025.card.swoosh',
};

const MAX_ITEM_QUANTITY = 10;
const MAX_TOTAL_QUANTITY = 20;
const PURCHASE_TIMEOUT_MS = 5 * 60 * 1000;

export type StoreCheckoutRequest = {
  requestId?: string;
  items?: unknown;
};

type QueueUnit = { productId: string; cardId: string };

type CheckoutResultPayload = {
  type: 'poplurStoreCheckoutResult';
  requestId: string;
  status: 'success' | 'cancelled' | 'pending' | 'failure';
  message: string;
  creditsAdded: number;
  completedItems: Array<{ productId: string; quantity: number; cardId?: string }>;
  availableCredits?: number;
  // Mirrors of the fields Android's native bridge also sends, so either
  // shape the web Store subscreen expects to read is present.
  success: boolean;
  ok: boolean;
};

function failureResult(requestId: string, message: string): CheckoutResultPayload {
  return {
    type: 'poplurStoreCheckoutResult',
    requestId,
    status: 'failure',
    message,
    creditsAdded: 0,
    completedItems: [],
    success: false,
    ok: false,
  };
}

/** Validates the bag the same way iOS/Android's native handlers do: every
 * cardId must be known, its product id must match the platform's catalog,
 * quantity is an integer 1-10, and the bag totals at most 20 units. */
function validatedQueue(requestId: string, rawItems: unknown): QueueUnit[] | null {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const productByCardId = Platform.OS === 'ios' ? IOS_PRODUCT_BY_CARD_ID : ANDROID_PRODUCT_BY_CARD_ID;
  const queue: QueueUnit[] = [];
  let total = 0;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    const cardId = typeof item.cardId === 'string' ? item.cardId : '';
    const productId = productByCardId[cardId];
    const iosProductId = typeof item.iosProductId === 'string' ? item.iosProductId : '';
    const androidProductId = typeof item.androidProductId === 'string' ? item.androidProductId : '';
    if (!productId) return null;
    if (IOS_PRODUCT_BY_CARD_ID[cardId] !== iosProductId
      || ANDROID_PRODUCT_BY_CARD_ID[cardId] !== androidProductId) return null;
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) return null;
    total += quantity;
    if (total > MAX_TOTAL_QUANTITY) return null;
    for (let i = 0; i < quantity; i++) queue.push({ productId, cardId });
  }
  return queue;
}

/** Matches PoplurStoreAccountToken.value(forFirebaseUID:) in
 * PoplurCardPurchaseService.swift and storeKitAccountToken(uid) in
 * cardPurchases.ts: SHA-256(uid), first 16 bytes, RFC 4122 version/variant
 * bits applied, formatted as a lowercase UUID. StoreKit2's appAccountToken
 * must match this exactly or the server rejects the transaction as
 * belonging to a different account. */
async function storeKitAccountToken(uid: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uid, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const bytePairs = hex.slice(0, 32).match(/.{2}/g) ?? [];
  const bytes = bytePairs.map(pair => parseInt(pair, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexBytes = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hexBytes.slice(0, 8)}-${hexBytes.slice(8, 12)}-${hexBytes.slice(12, 16)}-${hexBytes.slice(16, 20)}-${hexBytes.slice(20)}`;
}

/** Matches googlePlayAccountBinding(uid) in cardPurchases.ts and
 * sha256Hex(userId) in PoplurBillingManager.kt: the full lowercase SHA-256
 * hex digest of the Firebase UID, set as Play Billing's obfuscatedAccountId. */
async function googlePlayAccountBinding(uid: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uid, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

let iapReady: Promise<void> | null = null;
let expectedProductId: string | null = null;
let onPurchaseForExpected: ((purchase: Purchase) => void) | null = null;
let onErrorForExpected: ((error: PurchaseError) => void) | null = null;

function ensureIapReady(): Promise<void> {
  if (!iapReady) {
    iapReady = (async () => {
      if (Platform.OS === 'ios') {
        // Poplur's native iOS app verifies StoreKit2's signed JWS
        // (jwsRepresentation); RNIap only exposes that via
        // Purchase.verificationResultIOS when running in SK2 mode.
        setupIap({ storekitMode: 'STOREKIT2_MODE' });
      }
      await initConnection();
      purchaseUpdatedListener(purchase => {
        if (expectedProductId && purchase.productId === expectedProductId && onPurchaseForExpected) {
          onPurchaseForExpected(purchase);
        }
      });
      purchaseErrorListener(error => {
        if (expectedProductId && (!error.productId || error.productId === expectedProductId) && onErrorForExpected) {
          onErrorForExpected(error);
        }
      });
    })();
  }
  return iapReady;
}

/** Buys exactly one unit of `productId` and resolves with the resulting
 * Purchase, or rejects (cancellation, store error, or timeout). Only one of
 * these can be in flight at a time (checkout processes its queue serially,
 * same as both native platforms), enforced by the module-level
 * `expectedProductId` gate above. */
function buyOne(productId: string, accountToken: string): Promise<Purchase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      expectedProductId = null;
      onPurchaseForExpected = null;
      onErrorForExpected = null;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('The store did not respond in time. Please try again.')));
    }, PURCHASE_TIMEOUT_MS);

    expectedProductId = productId;
    onPurchaseForExpected = purchase => finish(() => resolve(purchase));
    onErrorForExpected = error => finish(() => reject(error));

    const purchaseRequest = Platform.OS === 'ios'
      ? requestPurchase({ sku: productId, appAccountToken: accountToken })
      : requestPurchase({ skus: [productId], obfuscatedAccountIdAndroid: accountToken });
    purchaseRequest.catch(error => finish(() => reject(error)));
  });
}

async function verifyWithServer(platform: 'ios' | 'android', productId: string, purchase: Purchase) {
  const payload: Record<string, unknown> = { platform, productId };
  if (platform === 'ios') {
    payload.signedTransaction = purchase.verificationResultIOS;
  } else {
    payload.purchaseToken = purchase.purchaseToken;
  }
  const verifyCardPurchase = httpsCallable(functions, 'verifyCardPurchase');
  const result = await verifyCardPurchase(payload);
  const data = result.data as Record<string, unknown> | null;
  if (!data || data.verified !== true || data.productId !== productId) {
    throw new Error('The purchase was not granted by Poplur. Your bag is unchanged; please try again.');
  }
  return {
    creditsAdded: typeof data.creditsAdded === 'number' ? data.creditsAdded : 0,
    availableCredits: typeof data.availableCredits === 'number' ? data.availableCredits : undefined,
  };
}

let activeRequestId: string | null = null;

/** Handles a `poplurStoreCheckoutRequested` message from the clay web bundle
 * and returns the `poplurStoreCheckoutResult` payload to post back via
 * `window.postMessage`. Mirrors PoplurCardPurchaseService.checkout() (iOS)
 * and requestStoreCheckout()/handleStorePurchaseEvent() (Android): items are
 * expanded into one-unit-at-a-time purchases, each StoreKit/Play Billing
 * purchase is verified server-side before the transaction is finished, and
 * the walk stops at the first cancellation/failure while still reporting
 * whatever completed beforehand. */
export async function handleStoreCheckoutRequested(message: StoreCheckoutRequest): Promise<CheckoutResultPayload> {
  const requestId = typeof message.requestId === 'string' && message.requestId.length <= 160
    ? message.requestId
    : '';
  if (!requestId) return failureResult('', 'The bag could not be validated. Please review it and try again.');

  const queue = validatedQueue(requestId, message.items);
  if (!queue) return failureResult(requestId, 'The bag could not be validated. Please review it and try again.');

  if (activeRequestId) {
    return failureResult(requestId, `Another ${Platform.OS === 'ios' ? 'App Store' : 'Google Play'} checkout is already in progress.`);
  }

  const uid = auth.currentUser?.uid;
  if (!uid) return failureResult(requestId, 'Sign in before purchasing Poplur Credits.');

  activeRequestId = requestId;
  try {
    await ensureIapReady();

    const uniqueProductIds = Array.from(new Set(queue.map(unit => unit.productId)));
    let available: Product[];
    try {
      available = await getProducts({ skus: uniqueProductIds });
    } catch {
      available = [];
    }
    const availableIds = new Set(available.map(product => product.productId));
    const missing = uniqueProductIds.filter(id => !availableIds.has(id));
    if (missing.length > 0) {
      return failureResult(
        requestId,
        `One or more cards are not available from the ${Platform.OS === 'ios' ? 'App Store' : 'Google Play Store'} yet.`,
      );
    }

    const accountToken = Platform.OS === 'ios'
      ? await storeKitAccountToken(uid)
      : await googlePlayAccountBinding(uid);
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';

    const completedItems: Array<{ productId: string; quantity: number; cardId?: string }> = [];
    let creditsAdded = 0;
    let availableCredits: number | undefined;
    const recordCompletion = (productId: string, cardId: string) => {
      const existing = completedItems.find(item => item.productId === productId);
      if (existing) existing.quantity += 1;
      else completedItems.push({ productId, quantity: 1, cardId });
    };

    for (const unit of queue) {
      let purchase: Purchase;
      try {
        purchase = await buyOne(unit.productId, accountToken);
      } catch (error) {
        const purchased = completedItems.reduce((sum, item) => sum + item.quantity, 0);
        const cancelled = (error as PurchaseError)?.code === 'E_USER_CANCELLED';
        const message = cancelled
          ? (purchased === 0
            ? 'Checkout was cancelled. Your bag is unchanged.'
            : `Checkout was cancelled after ${purchased} item${purchased === 1 ? '' : 's'} completed. Only the remaining items stay in your bag.`)
          : (error instanceof Error ? error.message : `${Platform.OS === 'ios' ? 'App Store' : 'Google Play'} checkout failed.`);
        return {
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: cancelled ? 'cancelled' : 'failure',
          message,
          creditsAdded,
          completedItems,
          availableCredits,
          success: false,
          ok: false,
        };
      }

      if (Platform.OS === 'android' && purchase.purchaseStateAndroid === PurchaseStateAndroid.PENDING) {
        return {
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: 'pending',
          message: 'Payment is pending in Google Play. Credits will be delivered only after payment completes.',
          creditsAdded,
          completedItems,
          availableCredits,
          success: false,
          ok: false,
        };
      }

      try {
        const grant = await verifyWithServer(platform, unit.productId, purchase);
        await finishTransaction({ purchase, isConsumable: true });
        creditsAdded += grant.creditsAdded;
        if (grant.availableCredits !== undefined) availableCredits = grant.availableCredits;
        recordCompletion(unit.productId, unit.cardId);
      } catch (error) {
        // Deliberately do not finish the transaction here: StoreKit/Play
        // still holds it unfinished so a retry (or the app's own recovery
        // pass) can redeliver it instead of losing the paid consumable.
        return {
          type: 'poplurStoreCheckoutResult',
          requestId,
          status: 'failure',
          message: error instanceof Error
            ? error.message
            : 'The purchase was not granted by Poplur. Your bag is unchanged; please try again.',
          creditsAdded,
          completedItems,
          availableCredits,
          success: false,
          ok: false,
        };
      }
    }

    const count = completedItems.reduce((sum, item) => sum + item.quantity, 0);
    const creditMessage = creditsAdded > 0
      ? ` ${creditsAdded.toLocaleString()} Poplur Credits were added.`
      : ' Your Poplur Credits are ready.';
    return {
      type: 'poplurStoreCheckoutResult',
      requestId,
      status: 'success',
      message: `${count} ${Platform.OS === 'ios' ? 'App Store' : 'Google Play'} purchase${count === 1 ? '' : 's'} verified.${creditMessage}`,
      creditsAdded,
      completedItems,
      availableCredits,
      success: true,
      ok: true,
    };
  } catch (error) {
    // Guarantee a result even if IAP setup itself failed (e.g. the store is
    // unreachable) — the web bag must never be left waiting forever.
    console.warn('[storeCheckout] checkout failed', error);
    return failureResult(
      requestId,
      error instanceof Error ? error.message : `${Platform.OS === 'ios' ? 'App Store' : 'Google Play'} checkout could not be started.`,
    );
  } finally {
    activeRequestId = null;
  }
}
