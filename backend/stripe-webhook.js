/**
 * PAP Magazine - Stripe Webhook Handler
 *
 * 이 코드는 Vercel, Netlify, AWS Lambda 등의 서버리스 함수로 배포해야 합니다.
 *
 * Vercel 예제:
 * 파일 위치: /api/webhook.js 또는 /api/webhooks/stripe.js
 *
 * Netlify 예제:
 * 파일 위치: /functions/stripe-webhook.js
 *
 * 설정 단계:
 * 1. Stripe 대시보드에서 Webhook endpoint 생성
 * 2. Endpoint URL: https://your-domain.com/api/stripe-webhook
 * 3. 이벤트 선택:
 *    - checkout.session.completed
 *    - customer.subscription.updated
 *    - customer.subscription.deleted
 *    - invoice.payment_succeeded
 *    - invoice.payment_failed
 * 4. STRIPE_WEBHOOK_SECRET 환경변수 설정 (Webhook signing secret)
 */

/**
 * ============================================================================
 * Vercel에 배포하는 경우
 * ============================================================================
 * /api/stripe-webhook.js에 다음 코드를 저장하세요.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // 서비스 역할 키 사용 (RLS 우회)
);

/**
 * Stripe Webhook 핸들러
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const body = req.body;

  let event;

  try {
    // Webhook 서명 검증
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // 이벤트 타입별 처리
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Checkout 세션 완료 처리
 * 사용자가 결제를 완료했을 때 호출됨
 */
async function handleCheckoutSessionCompleted(session) {
  console.log('Processing checkout.session.completed:', session.id);

  try {
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // 메타데이터에서 사용자 ID 가져오기
    // checkout 세션 생성 시 metadata.user_id를 설정해야 함
    const userId = session.metadata?.user_id;

    if (!userId) {
      console.error('User ID not found in session metadata');
      return;
    }

    // Subscription 정보 조회
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Price ID에서 플랜 이름 추출
    const priceId = subscription.items.data[0].price.id;
    const plan = getPlanNameFromPriceId(priceId);
    const billingCycle = subscription.items.data[0].price.recurring?.interval || 'unknown';

    // Supabase에 구독 정보 저장
    const { error } = await supabase
      .from('subscribers')
      .upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan: plan,
          billing_cycle: billingCycle,
          status: 'active',
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('Database update error:', error);
      return;
    }

    // 사용자 프로필의 구독 상태 업데이트
    await supabase
      .from('profiles')
      .update({
        subscription_plan: plan,
        subscription_status: 'active',
      })
      .eq('id', userId);

    console.log('✅ Subscription created for user:', userId);
  } catch (error) {
    console.error('Error in handleCheckoutSessionCompleted:', error);
    throw error;
  }
}

/**
 * 구독 업데이트 처리
 * 구독 정보가 변경되었을 때 호출됨 (ex: 취소, 일시중지)
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('Processing customer.subscription.updated:', subscription.id);

  try {
    const customerId = subscription.customer;
    const status = subscription.status;

    // Stripe 고객 ID로 사용자 찾기
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!subscriber) {
      console.warn('Subscriber not found for customer:', customerId);
      return;
    }

    const userId = subscriber.user_id;

    // 구독 상태 매핑
    let dbStatus = 'active';
    if (status === 'past_due' || status === 'unpaid') {
      dbStatus = 'active'; // 결제 대기중이지만 활성 상태로 처리
    } else if (status === 'canceled') {
      dbStatus = 'canceled';
    }

    // Supabase 업데이트
    const { error } = await supabase
      .from('subscribers')
      .update({
        status: dbStatus,
        current_period_end: new Date(subscription.current_period_end * 1000),
        cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Database update error:', error);
      return;
    }

    // 취소된 경우 프로필 업데이트
    if (dbStatus === 'canceled') {
      await supabase
        .from('profiles')
        .update({ subscription_status: 'inactive' })
        .eq('id', userId);
    }

    console.log('✅ Subscription updated for user:', userId);
  } catch (error) {
    console.error('Error in handleSubscriptionUpdated:', error);
    throw error;
  }
}

/**
 * 구독 삭제 처리
 * 구독이 완전히 취소되었을 때 호출됨
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('Processing customer.subscription.deleted:', subscription.id);

  try {
    const customerId = subscription.customer;

    // Stripe 고객 ID로 사용자 찾기
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!subscriber) {
      console.warn('Subscriber not found for customer:', customerId);
      return;
    }

    const userId = subscriber.user_id;

    // 구독 상태를 'canceled'로 업데이트
    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Database update error:', error);
      return;
    }

    // 프로필 업데이트
    await supabase
      .from('profiles')
      .update({ subscription_status: 'inactive' })
      .eq('id', userId);

    console.log('✅ Subscription deleted for user:', userId);
  } catch (error) {
    console.error('Error in handleSubscriptionDeleted:', error);
    throw error;
  }
}

/**
 * 송장 결제 성공 처리
 */
async function handleInvoicePaymentSucceeded(invoice) {
  console.log('Processing invoice.payment_succeeded:', invoice.id);

  try {
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    // 필요한 경우 추가 처리 (예: 영수증 발송)
    console.log('✅ Invoice payment succeeded for customer:', customerId);
  } catch (error) {
    console.error('Error in handleInvoicePaymentSucceeded:', error);
    throw error;
  }
}

/**
 * 송장 결제 실패 처리
 */
async function handleInvoicePaymentFailed(invoice) {
  console.log('Processing invoice.payment_failed:', invoice.id);

  try {
    const customerId = invoice.customer;

    // 결제 실패 처리 (예: 알림 발송)
    console.log('⚠️  Invoice payment failed for customer:', customerId);
  } catch (error) {
    console.error('Error in handleInvoicePaymentFailed:', error);
    throw error;
  }
}

/**
 * Price ID에서 플랜 이름 추출
 */
function getPlanNameFromPriceId(priceId) {
  // Stripe 대시보드에서 설정한 Price ID 매핑
  const priceMap = {
    'price_standard_monthly': 'standard_monthly',
    'price_standard_yearly': 'standard_yearly',
    'price_premium_monthly': 'premium_monthly',
    'price_premium_yearly': 'premium_yearly',
  };

  return priceMap[priceId] || 'unknown';
}

/**
 * ============================================================================
 * Netlify에 배포하는 경우
 * ============================================================================
 * /functions/stripe-webhook.js에 다음 코드를 저장하세요.
 */

/*
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const sig = event.headers['stripe-signature'];
  const body = event.body;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(stripeEvent.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripeEvent.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object);
        break;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook processing failed' }),
    };
  }
};
*/

/**
 * ============================================================================
 * 백엔드 서버리스 함수 설정 가이드
 * ============================================================================
 *
 * 1. Vercel 배포
 * ├─ API 키 설정 (환경변수)
 * │  ├─ STRIPE_SECRET_KEY: sk_live_xxxxx (또는 sk_test_xxxxx)
 * │  ├─ STRIPE_WEBHOOK_SECRET: whsec_xxxxx
 * │  ├─ SUPABASE_URL: https://xxxxx.supabase.co
 * │  └─ SUPABASE_SERVICE_KEY: (Service Role Key)
 * │
 * ├─ Webhook URL 설정
 * │  └─ https://your-domain.vercel.app/api/stripe-webhook
 * │
 * └─ 배포: vercel deploy
 *
 * 2. Netlify 배포
 * ├─ API 키 설정 (환경변수)
 * │  └─ netlify.toml에서 또는 Netlify UI
 * │
 * ├─ Webhook URL
 * │  └─ https://your-domain.netlify.app/.netlify/functions/stripe-webhook
 * │
 * └─ 배포: netlify deploy
 *
 * 3. AWS Lambda 배포
 * ├─ API Gateway 설정
 * │  └─ POST /stripe-webhook
 * │
 * ├─ Lambda 함수 코드
 * │  └─ 위의 handler 함수 변환
 * │
 * └─ 환경변수 설정
 *
 * Stripe 대시보드에서:
 * ├─ 개발자 > Webhooks로 이동
 * ├─ 엔드포인트 추가: https://your-domain.com/api/stripe-webhook
 * └─ 이벤트 선택:
 *    - checkout.session.completed
 *    - customer.subscription.updated
 *    - customer.subscription.deleted
 *    - invoice.payment_succeeded
 *    - invoice.payment_failed
 *
 * ============================================================================
 * 추가 필요한 서버리스 함수
 * ============================================================================
 */

/**
 * API: Checkout 세션 생성
 * POST /api/create-checkout-session
 */
/*
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { priceId, userId, email, successUrl, cancelUrl } = req.body;

    if (!priceId || !userId || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Stripe Checkout 세션 생성
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId,
      },
    });

    return res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    return res.status(500).json({ error: error.message });
  }
}
*/

/**
 * API: 구독 취소
 * POST /api/cancel-subscription
 */
/*
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Supabase에서 Stripe subscription ID 조회
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('stripe_subscription_id')
      .eq('user_id', userId)
      .single();

    if (!subscriber) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Stripe 구독 취소
    await stripe.subscriptions.del(subscriber.stripe_subscription_id);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ error: error.message });
  }
}
*/
