'use client';

import { motion } from 'framer-motion';
import { Terminal, Copy, Check } from 'lucide-react';
import { useState } from 'react';

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

export function CodePreview() {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <section className="w-full py-24 px-6 overflow-hidden">
            <div className="mx-auto max-w-5xl">
                <div className="mb-12 text-center">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        Real-world Orchestration.
                    </h2>
                    <p className="mt-4 text-zinc-400">
                        From inventory management to payment processing, SPANE handles the complexity.
                    </p>
                </div>

                <div className="relative rounded-2xl border border-zinc-800 bg-[#0c0c0c] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1.5">
                                <div className="h-3 w-3 rounded-full bg-red-500/50" />
                                <div className="h-3 w-3 rounded-full bg-yellow-500/50" />
                                <div className="h-3 w-3 rounded-full bg-green-500/50" />
                            </div>
                            <span className="ml-2 text-xs font-medium text-zinc-500 flex items-center gap-1.5">
                                <Terminal className="h-3 w-3" /> order-pipeline.ts
                            </span>
                        </div>
                        <button
                            onClick={copyToClipboard}
                            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                        >
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>

                    <div className="p-6 sm:p-10 overflow-x-auto">
                        <pre className="text-sm sm:text-base leading-relaxed text-zinc-300">
                            <code dangerouslySetInnerHTML={{
                                __html: code
                                    .replace(/import/g, '<span class="text-purple-400">import</span>')
                                    .replace(/from/g, '<span class="text-purple-400">from</span>')
                                    .replace(/const/g, '<span class="text-blue-400">const</span>')
                                    .replace(/new/g, '<span class="text-blue-400">new</span>')
                                    .replace(/await/g, '<span class="text-blue-400">await</span>')
                                    .replace(/\/\/.*/g, '<span class="text-zinc-500">$&</span>')
                                    .replace(/'[^']*'/g, '<span class="text-green-400">$&</span>')
                                    .replace(/process\.env\.[A-Z_]*/g, '<span class="text-orange-400">$&</span>')
                            }} />
                        </pre>
                    </div>

                    {/* Decorative glow */}
                    <div className="absolute -bottom-10 -right-10 h-64 w-64 rounded-full bg-blue-500/5 blur-[80px]" />
                    <div className="absolute -top-10 -left-10 h-64 w-64 rounded-full bg-purple-500/5 blur-[80px]" />
                </div>
            </div>
        </section>
    );
}
