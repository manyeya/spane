'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Check, Zap, Database, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  { id: 1, icon: Zap, label: 'Enqueue', color: 'from-blue-500 to-cyan-500' },
  { id: 2, icon: Clock, label: 'Queue', color: 'from-purple-500 to-pink-500' },
  { id: 3, icon: Database, label: 'Execute', color: 'from-orange-500 to-red-500' },
  { id: 4, icon: Check, label: 'Complete', color: 'from-green-500 to-emerald-500' },
];

export function HowItWorks() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const stepsContainerRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineRef = useRef<HTMLDivElement>(null);
  const dataPacketsRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!container.current) return;

    // CRITICAL: Set initial values to prevent flicker
    gsap.set(titleRef.current, { opacity: 0, y: 50 });
    gsap.set(subtitleRef.current, { opacity: 0, y: 30 });
    gsap.set(lineRef.current, { scaleX: 0 });
    stepRefs.current.forEach((step) => {
      if (step) gsap.set(step, { opacity: 0, y: 40 });
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

    // Animate line drawing
    gsap.to(lineRef.current, {
      scaleX: 1,
      duration: 1.2,
      ease: 'power2.inOut',
      scrollTrigger: {
        trigger: lineRef.current,
        start: 'top 80%',
      }
    });

    // Steps stagger animation
    stepRefs.current.forEach((step, i) => {
      if (step) {
        gsap.to(step, {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: step,
            start: 'top 85%',
          }
        });

        // Icon pulse on hover
        const icon = step.querySelector('.step-icon');
        if (icon) {
          step.addEventListener('mouseenter', () => {
            gsap.to(icon, { scale: 1.15, rotation: 5, duration: 0.3, ease: 'back.out(1.7)' });
          });
          step.addEventListener('mouseleave', () => {
            gsap.to(icon, { scale: 1, rotation: 0, duration: 0.5, ease: 'power2.out' });
          });
        }
      }
    });

    // Animate data packets flowing along the line
    const animatePackets = () => {
      if (!dataPacketsRef.current) return;

      const packets = dataPacketsRef.current.querySelectorAll('.data-packet');
      packets.forEach((packet, i) => {
        gsap.to(packet, {
          left: '100%',
          duration: 2.5,
          repeat: -1,
          ease: 'none',
          delay: i * 0.6,
        });
      });
    };

    // Start packet animation when in view
    ScrollTrigger.create({
      trigger: stepsContainerRef.current,
      start: 'top 70%',
      onEnter: animatePackets,
      once: true
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
            How It{' '}
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Works
            </span>
          </h2>
          <p
            ref={subtitleRef}
            className="text-zinc-400 max-w-2xl mx-auto text-lg"
          >
            SPANE orchestrates your workflows with intelligent parallel execution
            and automatic dependency resolution.
          </p>
        </div>

        {/* Workflow Visualization */}
        <div
          ref={stepsContainerRef}
          className="relative"
        >
          {/* Steps */}
          <div className="relative grid grid-cols-4 gap-8 z-10  bg-[radial-gradient(circle_at_center,transparent_20%,black_100%)] w-full">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.id}
                  ref={(el) => { stepRefs.current[index] = el; }}
                  className="flex flex-col items-center gap-6 group"
                >
                  {/* Icon Circle */}
                  <div className="relative ">
                    <div className={cn(
                      'z-[9999] step-icon relative  flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br transition-transform duration-300',
                      step.color
                    )}>
                      <Icon className="h-8 w-8 text-white" />
                      <div className="absolute inset-0 rounded-2xl bg-black/20" />
                    </div>
                    {/* Glow effect */}
                    <div className={cn(
                      'absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br blur-2xl opacity-50 transition-opacity duration-300 group-hover:opacity-80',
                      step.color
                    )} />
                  </div>

                  {/* Label */}
                  <div className="text-center">
                    <div className="text-xs font-medium text-zinc-500 mb-1">Step {step.id}</div>
                    <h3 className="text-lg font-semibold text-white">{step.label}</h3>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Connection Line - positioned to align with icon centers */}
          <div className="absolute left-0 right-0 h-0.5 z-0" style={{ top: '2.5rem' }}>
            <div
              ref={lineRef}
              className="h-full w-full bg-gradient-to-r from-blue-400/20 via-purple-400/60 to-green-400/20 origin-left"
            />
            {/* Data Packets */}
            <div ref={dataPacketsRef} className="absolute inset-0">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="data-packet absolute top-1/2 -translate-y-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]"
                  style={{
                    left: '0%',
                    maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)'
                  }}
                >
                  <div className="absolute inset-0 rounded-full bg-white animate-ping opacity-50" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature Pills */}
        <div className="mt-20 flex flex-wrap items-center justify-center gap-4">
          {[
            { label: 'DAG-based Flows', color: 'border-blue-500/30 text-blue-400' },
            { label: 'Parallel Execution', color: 'border-purple-500/30 text-purple-400' },
            { label: 'Auto Retries', color: 'border-orange-500/30 text-orange-400' },
            { label: 'State Persistence', color: 'border-green-500/30 text-green-400' },
          ].map((feature, i) => (
            <div
              key={i}
              className={cn(
                'px-5 py-2.5 rounded-full border bg-zinc-950/50 backdrop-blur-sm text-sm font-medium',
                feature.color
              )}
            >
              {feature.label}
            </div>
          ))}
        </div>
      </div>

      {/* Background Decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-blue-500/5 blur-[150px]" />
      </div>
    </section>
  );
}
