'use client';

import { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Terminal, Copy, Check, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

// Split code into logical blocks for animation
const codeBlocks = [
  `import { WorkflowEngine, NodeRegistry, DrizzleStore } from 'spane';`,

  `// 1. Define your business logic executors
const registry = new NodeRegistry();`,

  `registry.register('inventory', new InventoryExecutor({
  action: 'reserve'
}));

registry.register('payment', new StripeExecutor({
  apiKey: process.env.STRIPE_KEY
}));`,

  `// 2. Orchestrate complex parallel flows
const workflow = {
  id: 'order-automation',
  entryNodeId: 'reserve-stock',
  nodes: [`,

  `  {
    id: 'reserve-stock',
    type: 'inventory',
    outputs: ['process-payment', 'log-metrics']
  },`,

  `  {
    id: 'process-payment',
    type: 'payment',
    inputs: ['reserve-stock'],
    retryPolicy: { maxAttempts: 3, backoff: 'exponential' }
  },`,

  `  {
    id: 'log-metrics',
    type: 'transform',
    inputs: ['reserve-stock']
  }`,

  `  ]
};`,

  `// 3. Execute at scale with BullMQ and Redis
const engine = new WorkflowEngine(registry, new DrizzleStore(db), redis);
await engine.enqueueWorkflow('order-automation', { orderId: 'ord_123' });`
];

const code = `import { WorkflowEngine, NodeRegistry, DrizzleStore } from 'spane';

// 1. Define your business logic executors
const registry = new NodeRegistry();

registry.register('inventory', new InventoryExecutor({
  action: 'reserve'
}));

registry.register('payment', new StripeExecutor({
  apiKey: process.env.STRIPE_KEY
}));

// 2. Orchestrate complex parallel flows
const workflow = {
  id: 'order-automation',
  entryNodeId: 'reserve-stock',
  nodes: [
    {
      id: 'reserve-stock',
      type: 'inventory',
      outputs: ['process-payment', 'log-metrics']
    },
    {
      id: 'process-payment',
      type: 'payment',
      inputs: ['reserve-stock'],
      retryPolicy: { maxAttempts: 3, backoff: 'exponential' }
    },
    {
      id: 'log-metrics',
      type: 'transform',
      inputs: ['reserve-stock']
    }
  ]
};

// 3. Execute at scale with BullMQ and Redis
const engine = new WorkflowEngine(registry, new DrizzleStore(db), redis);
await engine.enqueueWorkflow('order-automation', { orderId: 'ord_123' });`;

const syntaxHighlight = (code: string) => {
  return code
    .replace(/import/g, '<span class="text-purple-400">import</span>')
    .replace(/from/g, '<span class="text-purple-400">from</span>')
    .replace(/const/g, '<span class="text-blue-400">const</span>')
    .replace(/new/g, '<span class="text-blue-400">new</span>')
    .replace(/await/g, '<span class="text-blue-400">await</span>')
    .replace(/\/\/.*/g, '<span class="text-zinc-500">$&</span>')
    .replace(/'[^']*'/g, '<span class="text-green-400">$&</span>')
    .replace(/process\.env\.[A-Z_]*/g, '<span class="text-orange-400">$&</span>')
    .replace(/WorkflowEngine|NodeRegistry|DrizzleStore/g, '<span class="text-cyan-400">$&</span>')
    .replace(/InventoryExecutor|StripeExecutor/g, '<span class="text-yellow-400">$&</span>');
};

export function CodePreview() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const codeBlockRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const [displayedCode, setDisplayedCode] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useGSAP(() => {
    if (!container.current) return;

    // CRITICAL: Set initial values BEFORE animations to prevent flicker
    gsap.set(titleRef.current, { opacity: 0, x: -50 });
    gsap.set(subtitleRef.current, { opacity: 0, x: 50 });
    gsap.set(codeBlockRef.current, { opacity: 0, y: 60, rotationX: 10 });

    // Title animation
    gsap.to(titleRef.current, {
      opacity: 1,
      x: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: titleRef.current,
        start: 'top 80%',
      }
    });

    gsap.to(subtitleRef.current, {
      opacity: 1,
      x: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: subtitleRef.current,
        start: 'top 80%',
      }
    });

    // Code block slide in
    gsap.to(codeBlockRef.current, {
      opacity: 1,
      y: 0,
      rotationX: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: codeBlockRef.current,
        start: 'top 80%',
        onEnter: () => {
          // Start typing animation when in view
          startTyping();
        },
        once: true
      }
    });

  }, { scope: container });

  const startTyping = () => {
    setIsTyping(true);
    setDisplayedCode('');
    let index = 0;
    const typingSpeed = 5; // ms per character

    const typeNext = () => {
      if (index < code.length) {
        setDisplayedCode(code.slice(0, index + 1));
        index += 2; // Type 2 chars at a time for speed
        setTimeout(typeNext, typingSpeed);
      } else {
        setIsTyping(false);
      }
    };

    typeNext();
  };

  // Cursor blink animation
  useGSAP(() => {
    if (cursorRef.current) {
      gsap.to(cursorRef.current, {
        opacity: 0,
        duration: 0.5,
        repeat: -1,
        yoyo: true,
        ease: 'none'
      });
    }
  });

  return (
    <section ref={container} className="w-full py-20 px-6 relative overflow-hidden">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-16 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h2
              ref={titleRef}
              className="text-4xl sm:text-5xl font-bold tracking-tight text-white"
            >
              Real-world{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Orchestration
              </span>
            </h2>
            <p
              ref={subtitleRef}
              className="mt-4 text-zinc-400 max-w-xl"
            >
              From inventory management to payment processing, SPANE handles the complexity.
            </p>
          </div>
          <a
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors group"
          >
            <span className="font-medium">Full documentation</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>

        {/* Code Block */}
        <div
          ref={codeBlockRef}
          className="relative rounded-3xl border border-zinc-800/50 bg-[#0a0a0a] overflow-hidden"
          style={{
            boxShadow: '0 0 100px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}
        >
          {/* Window controls */}
          <div className="flex items-center justify-between border-b border-zinc-800/50 px-6 py-4 bg-zinc-950/50">
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500/80" />
                <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                <div className="h-3 w-3 rounded-full bg-green-500/80" />
              </div>
              <span className="ml-3 text-xs font-medium text-zinc-500 flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5" />
                order-pipeline.ts
              </span>
            </div>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied!' : 'Copy code'}
            </button>
          </div>

          {/* Code content */}
          <div className="pl-16 p-6 sm:pl-20 sm:p-8 overflow-x-auto">
            <pre className="text-sm sm:text-base leading-relaxed text-zinc-300 font-mono">
              <code
                dangerouslySetInnerHTML={{
                  __html: syntaxHighlight(displayedCode)
                }}
              />
              {isTyping && (
                <span ref={cursorRef} className="inline-block w-2 h-4 bg-blue-400 ml-1 align-middle" />
              )}
            </pre>
          </div>

          {/* Line numbers */}
          <div className="absolute left-0 top-[60px] bottom-0 w-12 border-r border-zinc-800/50 bg-zinc-950/30 flex flex-col items-end pr-3 pt-6 text-xs text-zinc-700 font-mono select-none">
            {Array.from({ length: 48 }, (_, i) => (
              <span key={i} className="leading-6">{i + 1}</span>
            ))}
          </div>

          {/* Decorative glows */}
          <div className="absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-blue-500/10 blur-[100px]" />
          <div className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-purple-500/10 blur-[100px]" />
        </div>

        {/* Feature pills */}
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          {['TypeScript', 'BullMQ', 'Redis', 'PostgreSQL', 'DAG', 'Retries'].map((feature) => (
            <span
              key={feature}
              className="px-4 py-2 rounded-full border border-zinc-800 bg-zinc-950/50 text-sm text-zinc-500"
            >
              {feature}
            </span>
          ))}
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[800px] w-[800px] rounded-full bg-blue-500/5 blur-[200px]" />
      </div>
    </section>
  );
}
