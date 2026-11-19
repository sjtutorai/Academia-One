export interface PaymentGatewayStatus {
  provider: string;
  configured: boolean;
  mode: 'manual_only' | 'online_ready';
  setupSteps: string[];
}

export function getPaymentGatewayStatus(): PaymentGatewayStatus {
  const provider = (import.meta.env.VITE_PAYMENT_PROVIDER as string | undefined) || 'manual_only';
  const pubKey = (import.meta.env.VITE_PAYMENT_PUBLIC_KEY as string | undefined) || '';
  const configured = provider !== 'manual_only' && pubKey.trim().length > 10;

  return {
    provider: configured ? provider : 'Stripe / Razorpay (Pending Configuration)',
    configured,
    mode: configured ? 'online_ready' : 'manual_only',
    setupSteps: [
      'Set VITE_PAYMENT_PROVIDER="stripe" or "razorpay" and VITE_PAYMENT_PUBLIC_KEY in environment secrets.',
      'Deploy a server-side webhook endpoint to verify checkout signatures and update schoolSubscriptions atomically.',
      'Until configured, all subscription renewals are explicitly recorded as Manual Payments with invoice reference numbers.',
    ],
  };
}
