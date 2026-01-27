'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';
import { Zap, Shield, Database, Activity, Layers, RefreshCw, GitBranch } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

interface BentoItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
  size: 'large' | 'medium' | 'small';
  stat?: string;
  statLabel?: string;
}

const bentoItems: BentoItem[] = [
  {
    icon: <RefreshCw className="h-6 w-6" />,
    title: 'Smart Retries',
    description: 'Exponential backoff with configurable max attempts. Failed jobs never get lost.',
    gradient: 'from-purple-500/20 to-pink-500/20',
    size: 'medium',
  },
  {
    icon: <Database className="h-6 w-6" />,
    title: 'State Persistence',
    description: 'Full workflow state saved to PostgreSQL. Resume exactly where you left off.',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    size: 'large',
    stat: '100%',
    statLabel: 'durable',
  },
  {
    icon: <Activity className="h-6 w-6" />,
    title: 'Real-time Events',
    description: 'Pub/Sub event streaming via Redis. Monitor executions as they happen.',
    gradient: 'from-green-500/20 to-emerald-500/20',
    size: 'medium',
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: 'Circuit Breakers',
    description: 'Protection for external services built natively into the engine processor.',
    gradient: 'from-red-500/20 to-orange-500/20',
    size: 'medium',
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: 'Sub-Workflows',
    description: 'Manage complexity by nesting workflows up to 10 levels deep.',
    gradient: 'from-indigo-500/20 to-violet-500/20',
    size: 'medium',
  },
  {
    icon: <GitBranch className="h-6 w-6" />,
    title: 'DAG Validation',
    description: 'Automatic cycle detection and reachability analysis on registration.',
    gradient: 'from-sky-500/20 to-blue-500/20',
    size: 'small',
  },
];

export function BentoFeatures() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const glowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useGSAP(() => {
    if (!container.current) return;

    // Title animation
    gsap.fromTo(titleRef.current,
      { opacity: 0, y: 60 },
      {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: titleRef.current,
          start: 'top 80%',
        }
      }
    );

    // Grid items stagger animation
    itemRefs.current.forEach((item, i) => {
      if (item) {
        gsap.fromTo(item,
          { opacity: 0, y: 80, scale: 0.9 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.8,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: item,
              start: 'top 85%',
            }
          }
        );

        // Hover glow effect setup
        const glow = glowRefs.current[i];
        if (glow && item) {
          item.addEventListener('mouseenter', () => {
            gsap.to(glow, {
              opacity: 1,
              scale: 1.5,
              duration: 0.5,
              ease: 'power2.out'
            });
          });

          item.addEventListener('mouseleave', () => {
            gsap.to(glow, {
              opacity: 0,
              scale: 1,
              duration: 0.5,
              ease: 'power2.in'
            });
          });
        }
      }
    });

  }, { scope: container });

  return (
    <section ref={container} className="w-full py-32 px-6 relative overflow-hidden">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-16">
          <h2
            ref={titleRef}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6"
          >
            Engineered for{' '}
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Reliability
            </span>
          </h2>
        </div>

        {/* Bento Grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[180px]"
        >
          {/* Large item - spans 2 cols, 2 rows */}
          <div
            ref={(el) => { itemRefs.current[0] = el; }}
            className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm"
          >
            <div
              ref={(el) => { glowRefs.current[0] = el; }}
              className={cn(
                'absolute inset-0 opacity-0 transition-all duration-500',
                'bg-gradient-to-br', bentoItems[0].gradient
              )}
            />
            <div className="relative h-full p-8 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div className={cn(
                  'h-12 w-12 rounded-2xl bg-gradient-to-br flex items-center justify-center',
                  bentoItems[0].gradient
                )}>
                  {bentoItems[0].icon}
                </div>
                {bentoItems[0].stat && (
                  <div className="text-right">
                    <div className="text-4xl font-bold text-white">{bentoItems[0].stat}</div>
                    <div className="text-sm text-zinc-500">{bentoItems[0].statLabel}</div>
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">{bentoItems[0].title}</h3>
                <p className="text-zinc-400 leading-relaxed">{bentoItems[0].description}</p>
              </div>
            </div>
          </div>

          {/* Medium items */}
          {bentoItems.slice(1, 4).map((item, idx) => (
            <div
              key={idx + 1}
              ref={(el) => { itemRefs.current[idx + 1] = el; }}
              className="md:col-span-1 md:row-span-1 group relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm"
            >
              <div
                ref={(el) => { glowRefs.current[idx + 1] = el; }}
                className={cn(
                  'absolute inset-0 opacity-0 transition-all duration-500',
                  'bg-gradient-to-br', item.gradient
                )}
              />
              <div className="relative h-full p-6 flex flex-col justify-between">
                <div className={cn(
                  'h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center',
                  item.gradient
                )}>
                  {item.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">{item.title}</h3>
                  <p className="text-sm text-zinc-500">{item.description}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Small items - stack them */}
          <div className="md:col-span-1 md:row-span-2 grid grid-rows-2 gap-4">
            {bentoItems.slice(4).map((item, idx) => (
              <div
                key={idx + 4}
                ref={(el) => { itemRefs.current[idx + 4] = el; }}
                className="group relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm"
              >
                <div
                  ref={(el) => { glowRefs.current[idx + 4] = el; }}
                  className={cn(
                    'absolute inset-0 opacity-0 transition-all duration-500',
                    'bg-gradient-to-br', item.gradient
                  )}
                />
                <div className="relative h-full p-5 flex flex-col justify-between">
                  <div className={cn(
                    'h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center',
                    item.gradient
                  )}>
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-0.5">{item.title}</h3>
                    <p className="text-xs text-zinc-500 line-clamp-2">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <p className="text-zinc-500 text-sm">
            Built on BullMQ + Redis • PostgreSQL persistence • Full TypeScript
          </p>
        </div>
      </div>

      {/* Decorative background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-blue-500/5 blur-[150px]" />
      </div>
    </section>
  );
}
