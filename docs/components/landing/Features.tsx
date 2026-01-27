'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';
import { Zap, Share2, ShieldCheck, Cpu } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    title: 'Parallel Execution',
    description: 'Built on BullMQ, SPANE natively handles thousands of parallel node executions across multiple workers.',
    icon: Zap,
    gradient: 'from-yellow-500/20 to-orange-500/20',
    iconColor: 'text-yellow-500',
  },
  {
    title: 'DAG Orchestration',
    description: 'Define complex Directed Acyclic Graphs simply. The engine handles all dependency logic and data flow.',
    icon: Share2,
    gradient: 'from-blue-500/20 to-cyan-500/20',
    iconColor: 'text-blue-500',
  },
  {
    title: 'Native Type Safety',
    description: 'Written in TypeScript, providing full end-to-end type safety for node configurations and execution results.',
    icon: ShieldCheck,
    gradient: 'from-green-500/20 to-emerald-500/20',
    iconColor: 'text-green-500',
  },
  {
    title: 'Highly Extensible',
    description: 'Create custom executors for any task. HTTP, Database, AI Workers, or anything you can code.',
    icon: Cpu,
    gradient: 'from-purple-500/20 to-pink-500/20',
    iconColor: 'text-purple-500',
  }
];

export function Features() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const featureRefs = useRef<(HTMLDivElement | null)[]>([]);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);

  useGSAP(() => {
    if (!container.current) return;

    // CRITICAL: Set initial values BEFORE animations to prevent flicker
    gsap.set(titleRef.current, { opacity: 0, y: 50 });
    gsap.set(subtitleRef.current, { opacity: 0, y: 30 });
    featureRefs.current.forEach((feature) => {
      if (feature) gsap.set(feature, { opacity: 0, y: 80, scale: 0.95 });
    });

    // Title animation
    gsap.to(titleRef.current, {
      opacity: 1,
      y: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: titleRef.current,
        start: 'top 80%',
      }
    });

    // Subtitle
    gsap.to(subtitleRef.current, {
      opacity: 1,
      y: 0,
      duration: 1,
      delay: 0.2,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: subtitleRef.current,
        start: 'top 80%',
      }
    });

    // Feature cards stagger
    featureRefs.current.forEach((feature, i) => {
      if (feature) {
        gsap.to(feature, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: feature,
            start: 'top 85%',
          }
        });

        // Icon rotation on hover
        const icon = iconRefs.current[i];
        if (icon && feature) {
          feature.addEventListener('mouseenter', () => {
            gsap.to(icon, {
              rotation: 15,
              scale: 1.1,
              duration: 0.3,
              ease: 'back.out(1.7)'
            });
          });

          feature.addEventListener('mouseleave', () => {
            gsap.to(icon, {
              rotation: 0,
              scale: 1,
              duration: 0.5,
              ease: 'power2.out'
            });
          });
        }
      }
    });

  }, { scope: container });

  return (
    <section ref={container} className="w-full py-20 px-6 relative overflow-hidden">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-20 text-center">
          <h2
            ref={titleRef}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6"
          >
            Built for{' '}
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Scale
            </span>
          </h2>
          <p
            ref={subtitleRef}
            className="text-zinc-400 text-lg max-w-2xl mx-auto"
          >
            A minimalist engine that doesn't get in your way.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              ref={(el) => { featureRefs.current[index] = el; }}
              className="group relative rounded-3xl border border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm p-8 transition-all hover:border-zinc-700/50"
              style={{
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)'
              }}
            >
              {/* Background gradient on hover */}
              <div className={cn(
                'absolute inset-0 rounded-3xl bg-gradient-to-br opacity-0 transition-opacity duration-500',
                feature.gradient
              )} />

              {/* Content */}
              <div className="relative z-10">
                <div
                  ref={(el) => { iconRefs.current[index] = el; }}
                  className={cn(
                    'mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br transition-transform duration-300',
                    feature.gradient
                  )}
                >
                  <feature.icon className={cn('h-7 w-7', feature.iconColor)} />
                </div>
                <h3 className="mb-3 text-lg font-semibold text-white">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {feature.description}
                </p>
              </div>

              {/* Hover glow */}
              <div className="absolute -inset-4 rounded-3xl bg-white/5 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100 pointer-events-none" />
            </div>
          ))}
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-purple-500/5 blur-[120px]" />
      </div>
    </section>
  );
}
