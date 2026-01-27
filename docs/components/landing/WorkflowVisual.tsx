'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  icon: string;
}

const nodes: Node[] = [
  { id: 1, label: 'Trigger', x: 10, y: 50, status: 'idle', icon: '⚡' },
  { id: 2, label: 'Fetch User', x: 30, y: 30, status: 'idle', icon: '👤' },
  { id: 3, label: 'Validate', x: 30, y: 70, status: 'idle', icon: '✓' },
  { id: 4, label: 'Process Data', x: 50, y: 50, status: 'idle', icon: '⚙️' },
  { id: 5, label: 'Transform', x: 70, y: 30, status: 'idle', icon: '🔄' },
  { id: 6, label: 'Enrich', x: 70, y: 70, status: 'idle', icon: '✨' },
  { id: 7, label: 'Output', x: 90, y: 50, status: 'idle', icon: '📤' },
];

const connections = [
  { from: 1, to: 2 },
  { from: 1, to: 3 },
  { from: 2, to: 4 },
  { from: 3, to: 4 },
  { from: 4, to: 5 },
  { from: 4, to: 6 },
  { from: 5, to: 7 },
  { from: 6, to: 7 },
];

export function WorkflowVisual() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const vizContainer = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const packetRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!container.current) return;

    // Title animation
    gsap.fromTo(titleRef.current,
      { opacity: 0, y: 50 },
      { opacity: 1, y: 0, duration: 1, ease: 'power3.out' }
    );

    gsap.fromTo(subtitleRef.current,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1, delay: 0.2, ease: 'power3.out' }
    );

    // Visualization container
    gsap.fromTo(vizContainer.current,
      { opacity: 0, scale: 0.95 },
      { opacity: 1, scale: 1, duration: 1, delay: 0.4, ease: 'power3.out' }
    );

    // Draw connection lines
    lineRefs.current.forEach((line, i) => {
      if (line) {
        gsap.fromTo(line,
          { strokeDashoffset: 1000 },
          {
            strokeDashoffset: 0,
            duration: 1.5,
            delay: 0.5 + i * 0.1,
            ease: 'power2.inOut'
          }
        );
      }
    });

    // Animate nodes in
    nodeRefs.current.forEach((node, i) => {
      if (node) {
        gsap.fromTo(node,
          { opacity: 0, scale: 0, x: '-=20' },
          {
            opacity: 1,
            scale: 1,
            x: '+=20',
            duration: 0.6,
            delay: 0.6 + i * 0.15,
            ease: 'back.out(1.7)'
          }
        );
      }
    });

    // Stats counter animation
    const stats = statsRef.current?.querySelectorAll('.stat-value');
    stats?.forEach((stat) => {
      const value = stat.getAttribute('data-value');
      if (value) {
        gsap.to(stat, {
          innerHTML: value,
          duration: 2,
          snap: { innerHTML: 1 },
          scrollTrigger: {
            trigger: stat,
            start: 'top 80%',
          }
        });
      }
    });

    // Continuous workflow animation
    runWorkflowAnimation();

  }, { scope: container });

  const runWorkflowAnimation = () => {
    if (!container.current) return;

    const timeline = gsap.timeline({ repeat: -1, repeatDelay: 1 });

    // Define the path for the data packet
    const path: [number, number][] = [
      [10, 50], [30, 30], [50, 50], [70, 30], [90, 50]
    ];

    // Animate packet along path
    path.forEach(([x, y], i) => {
      timeline.to(packetRef.current, {
        left: x + '%',
        top: y + '%',
        duration: 0.8,
        ease: 'power2.inOut',
        onUpdate: () => {
          // Update node statuses based on packet position
          nodeRefs.current.forEach((node, idx) => {
            const nodeEl = node as HTMLElement;
            if (!nodeEl) return;

            const nodeData = nodes[idx];
            const packetProgress = i / (path.length - 1);

            if (idx === i) {
              nodeEl.dataset.status = 'running';
            } else if (idx < i) {
              nodeEl.dataset.status = 'complete';
            } else {
              nodeEl.dataset.status = 'idle';
            }
          });
        }
      });
    });

    // Second path (bottom branch)
    const path2: [number, number][] = [
      [10, 50], [30, 70], [50, 50], [70, 70], [90, 50]
    ];

    path2.forEach(([x, y], i) => {
      timeline.to(packetRef.current, {
        left: x + '%',
        top: y + '%',
        duration: 0.8,
        ease: 'power2.inOut'
      }, i * 0.8);
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500';
      case 'complete': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-zinc-600';
    }
  };

  const getStatusGlow = (status: string) => {
    switch (status) {
      case 'running': return 'shadow-blue-500/50';
      case 'complete': return 'shadow-green-500/50';
      case 'error': return 'shadow-red-500/50';
      default: return 'shadow-zinc-600/30';
    }
  };

  return (
    <section ref={container} className="w-full py-32 px-6 relative overflow-hidden">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-20 text-center">
          <h2
            ref={titleRef}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6"
          >
            Orchestration,{' '}
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Visualized
            </span>
          </h2>
          <p
            ref={subtitleRef}
            className="text-zinc-400 max-w-2xl mx-auto text-lg"
          >
            Watch SPANE manage complex DAG flows with parallel execution branches.
            Tasks execute concurrently while maintaining strict dependency orders.
          </p>
        </div>

        {/* Visualization */}
        <div
          ref={vizContainer}
          className="relative aspect-[16/9] w-full rounded-[2.5rem] border border-zinc-800/50 bg-gradient-to-br from-zinc-950 to-black p-8 md:p-12 overflow-hidden"
          style={{
            boxShadow: '0 0 100px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}
        >
          {/* Background effects */}
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.08),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(168,85,247,0.08),transparent_50%)]" />

            {/* Animated grid */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute inset-0 h-full w-full bg-[linear-gradient(to_right,#3f3f46_1px,transparent_1px),linear-gradient(to_bottom,#3f3f46_1px,transparent_1px)] bg-size-[3rem_3rem]" />
            </div>
          </div>

          {/* Connection lines */}
          <svg className="absolute inset-0 h-full w-full" style={{ zIndex: 1 }}>
            <defs>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.2" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {connections.map((conn, i) => {
              const fromNode = nodes.find(n => n.id === conn.from)!;
              const toNode = nodes.find(n => n.id === conn.to)!;
              return (
                <line
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  x1={`${fromNode.x}%`}
                  y1={`${fromNode.y}%`}
                  x2={`${toNode.x}%`}
                  y2={`${toNode.y}%`}
                  stroke="url(#lineGradient)"
                  strokeWidth="2"
                  strokeDasharray="1000"
                  strokeDashoffset="1000"
                  filter="url(#glow)"
                  className="opacity-50"
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node, i) => (
            <div
              key={node.id}
              ref={(el) => { nodeRefs.current[i] = el; }}
              data-status="idle"
              className="absolute flex flex-col items-center gap-2 transition-all duration-300"
              style={{
                left: `${node.x}%`,
                top: `${node.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 10
              }}
            >
              <div
                className={cn(
                  'relative flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-2xl border transition-all duration-500',
                  'bg-zinc-900/80 backdrop-blur-md border-zinc-700/50',
                  'data-[status=running]:border-blue-500/50 data-[status=running]:shadow-lg data-[status=running]:shadow-blue-500/30',
                  'data-[status=complete]:border-green-500/50 data-[status=complete]:shadow-lg data-[status=complete]:shadow-green-500/30'
                )}
              >
                <span className="text-2xl">{node.icon}</span>
                <div className="status-indicator absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-600 border-2 border-zinc-900 transition-colors duration-300" />
              </div>
              <span className="text-xs md:text-sm font-medium text-zinc-400 whitespace-nowrap hidden sm:block">
                {node.label}
              </span>
            </div>
          ))}

          {/* Data packet */}
          <div
            ref={packetRef}
            className="absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.8)]"
            style={{ left: '10%', top: '50%' }}
          >
            <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-75" />
          </div>

          {/* Stats overlay */}
          <div
            ref={statsRef}
            className="absolute bottom-6 left-6 right-6 flex flex-wrap gap-4 md:gap-8 justify-around rounded-2xl border border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm p-4 md:p-6"
            style={{ zIndex: 15 }}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <span className="text-blue-400">⚡</span>
              </div>
              <div>
                <div className="stat-value text-xl font-bold text-white" data-value="10000">0</div>
                <div className="text-xs text-zinc-500">jobs/sec</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                <span className="text-green-400">✓</span>
              </div>
              <div>
                <div className="stat-value text-xl font-bold text-white" data-value="99.9">0</div>
                <div className="text-xs text-zinc-500">% uptime</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <span className="text-purple-400">∞</span>
              </div>
              <div>
                <div className="stat-value text-xl font-bold text-white" data-value="∞">∞</div>
                <div className="text-xs text-zinc-500">scalability</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-1/2 left-0 h-px w-32 bg-gradient-to-r from-transparent to-zinc-800" />
      <div className="absolute top-1/2 right-0 h-px w-32 bg-gradient-to-l from-transparent to-zinc-800" />
    </section>
  );
}
