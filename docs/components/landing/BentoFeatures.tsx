'use client';

import { useRef, useState, useCallback } from 'react';
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
  gradientBorder?: string;
}

const bentoItems: BentoItem[] = [
  {
    icon: <RefreshCw className="h-6 w-6" />,
    title: 'Smart Retries',
    description: 'Exponential backoff with configurable max attempts. Failed jobs never get lost.',
    gradient: 'from-purple-500/20 to-pink-500/20',
    gradientBorder: 'from-purple-500 to-pink-500',
    size: 'medium',
  },
  {
    icon: <Database className="h-6 w-6" />,
    title: 'State Persistence',
    description: 'Full workflow state saved to PostgreSQL. Resume exactly where you left off.',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    gradientBorder: 'from-blue-500 to-cyan-500',
    size: 'large',
    stat: '100',
    statLabel: '% durable',
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: 'Circuit Breakers',
    description: 'Protection for external services built natively into the engine processor.',
    gradient: 'from-red-500/20 to-orange-500/20',
    gradientBorder: 'from-red-500 to-orange-500',
    size: 'medium',
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: 'Sub-Workflows',
    description: 'Manage complexity by nesting workflows up to 10 levels deep.',
    gradient: 'from-indigo-500/20 to-violet-500/20',
    gradientBorder: 'from-indigo-500 to-violet-500',
    size: 'medium',
  },
  {
    icon: <GitBranch className="h-6 w-6" />,
    title: 'DAG Validation',
    description: 'Automatic cycle detection and reachability analysis on registration.',
    gradient: 'from-sky-500/20 to-blue-500/20',
    gradientBorder: 'from-sky-500 to-blue-500',
    size: 'small',
  },
];

interface BentoCardProps {
  item: BentoItem;
  index: number;
  cardRef: (el: HTMLDivElement | null) => void;
  spotlightRef: (el: HTMLDivElement | null) => void;
  iconRef: (el: HTMLDivElement | null) => void;
  counterRef: (el: HTMLSpanElement | null) => void;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  isHovered: boolean;
}

function BentoCard({ item, index, cardRef, spotlightRef, iconRef, counterRef, onMouseMove, onMouseLeave, isHovered }: BentoCardProps) {
  const isLarge = item.size === 'large';
  const isSmall = item.size === 'small';

  return (
    <div
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn(
        'group relative overflow-hidden rounded-3xl border border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm',
        'transform-gpu transition-transform duration-300 ease-out',
        'hover:border-zinc-700/50',
        isLarge && 'md:col-span-2 md:row-span-2',
        !isLarge && !isSmall && 'md:col-span-1 md:row-span-1',
      )}
      style={{ perspective: '1000px' }}
    >
      {/* Animated gradient border */}
      <div className={cn(
        'absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500',
        'bg-gradient-to-br p-[1px]'
      )}>
        <div className={cn('absolute inset-0 rounded-3xl bg-gradient-to-br', item.gradientBorder)} />
      </div>

      {/* Cursor spotlight effect */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-300"
        style={{
          background: 'radial-gradient(circle 150px at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.1), transparent 40%)',
        }}
      />

      {/* Hover gradient overlay */}
      <div className={cn(
        'absolute inset-0 opacity-0 group-hover:opacity-40 transition-opacity duration-700 bg-gradient-to-br',
        item.gradient
      )} />

      {/* Animated background mesh */}
      <svg
        className="absolute inset-0 w-full h-full opacity-0 group-hover:opacity-20 transition-opacity duration-700 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id={`grid-${index}`} width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="currentColor" className="text-zinc-600" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#grid-${index})`} />
      </svg>

      {/* Content */}
      <div className={cn(
        'relative h-full p-6 flex flex-col justify-between',
        isLarge && 'p-8'
      )}>
        <div className="flex items-start justify-between">
          {/* Animated floating icon */}
          <div
            ref={iconRef}
            className={cn(
              'rounded-2xl bg-gradient-to-br flex items-center justify-center',
              'transform-gpu',
              isLarge ? 'h-14 w-14' : 'h-10 w-10',
              item.gradient
            )}
          >
            <span className="icon-wrapper">{item.icon}</span>
          </div>

          {/* Stat with counter animation */}
          {item.stat && (
            <div className="text-right">
              <div className="flex items-baseline justify-end gap-1">
                <span
                  ref={counterRef}
                  className="text-4xl font-bold text-white tabular-nums"
                >
                  {item.stat}
                </span>
                <span className="text-xl font-bold text-white/80">%</span>
              </div>
              <div className="text-sm text-zinc-500">{item.statLabel}</div>
            </div>
          )}
        </div>

        <div className={cn('space-y-1', isLarge && 'space-y-2')}>
          <h3 className={cn(
            'font-bold text-white group-hover:text-white/100 transition-colors duration-300',
            isLarge ? 'text-2xl' : isSmall ? 'text-base' : 'text-lg'
          )}>
            {item.title}
          </h3>
          <p className={cn(
            'text-zinc-500 group-hover:text-zinc-300 transition-colors duration-300 leading-relaxed',
            isLarge ? 'text-sm' : 'text-xs'
          )}>
            {item.description}
          </p>
        </div>
      </div>

      {/* Corner accent */}
      <div className={cn(
        'absolute bottom-0 right-0 w-16 h-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500',
        'bg-gradient-to-tl from-white/5 to-transparent'
      )} />
    </div>
  );
}

export function BentoFeatures() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Store refs for GSAP animations
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const spotlightRefs = useRef<(HTMLDivElement | null)[]>([]);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const counterRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // 3D tilt effect on mouse move
  const handleMouseMove = useCallback((index: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRefs.current[index];
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Calculate rotation (max 5 degrees for subtle effect)
    const rotateX = (y - centerY) / centerY * -3;
    const rotateY = (x - centerX) / centerX * 3;

    // Update spotlight position
    const spotlight = spotlightRefs.current[index];
    if (spotlight) {
      const xPercent = (x / rect.width) * 100;
      const yPercent = (y / rect.height) * 100;
      gsap.set(spotlight, {
        '--mouse-x': `${xPercent}%`,
        '--mouse-y': `${yPercent}%`,
      } as any);
    }

    gsap.to(card, {
      rotateX,
      rotateY,
      scale: 1.02,
      duration: 0.4,
      ease: 'power2.out',
    });

    setHoveredIndex(index);
  }, []);

  const handleMouseLeave = useCallback((index: number) => () => {
    const card = cardRefs.current[index];
    if (!card) return;

    gsap.to(card, {
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      duration: 0.5,
      ease: 'elastic.out(1, 0.5)',
    });

    setHoveredIndex(null);
  }, []);

  // Animated icon floating + spotlight opacity
  useGSAP(() => {
    // Animate background orbs
    gsap.to('.orb-bg', {
      scale: 1.2,
      opacity: 0.15,
      duration: 4,
      stagger: 1,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });

    iconRefs.current.forEach((iconRef, i) => {
      if (!iconRef) return;

      const iconWrapper = iconRef.querySelector('.icon-wrapper');

      // Create floating animation that plays on hover
      const floatTween = gsap.to(iconWrapper, {
        y: -4,
        rotation: 5,
        duration: 0.6,
        ease: 'power1.inOut',
        paused: true,
      });

      const card = cardRefs.current[i];
      const spotlight = spotlightRefs.current[i];

      if (card) {
        card.addEventListener('mouseenter', () => {
          floatTween.play();
          if (spotlight) {
            gsap.to(spotlight, { opacity: 1, duration: 0.3 });
          }
        });
        card.addEventListener('mouseleave', () => {
          floatTween.reverse();
          if (spotlight) {
            gsap.to(spotlight, { opacity: 0, duration: 0.3 });
          }
        });
      }

      // Subtle idle animation
      gsap.to(iconWrapper, {
        scale: 1.05,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: i * 0.2,
      });
    });
  }, []);

  useGSAP(() => {
    if (!container.current) return;

    // CRITICAL: Set initial values BEFORE animations to prevent flicker
    gsap.set(titleRef.current, { opacity: 0, y: 60, rotateX: 15 });
    cardRefs.current.forEach((card, i) => {
      if (card) {
        gsap.set(card, {
          opacity: 0,
          y: 100 + (i * 20),
          rotateX: 15,
          rotateY: i % 2 === 0 ? -5 : 5,
        });
      }
    });

    // Title 3D reveal animation
    gsap.to(titleRef.current, {
      opacity: 1,
      y: 0,
      rotateX: 0,
      duration: 1.2,
      ease: 'power4.out',
      scrollTrigger: {
        trigger: titleRef.current,
        start: 'top 85%',
      }
    });

    // Cards stagger animation with 3D effect
    cardRefs.current.forEach((card, i) => {
      if (card) {
        gsap.to(card, {
          opacity: 1,
          y: 0,
          rotateX: 0,
          rotateY: 0,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: card,
            start: 'top 90%',
          }
        });

        // Counter animation for stats
        const counter = counterRefs.current[i];
        if (counter && bentoItems[i]?.stat) {
          const targetValue = parseInt(bentoItems[i].stat!);
          gsap.from(counter, {
            textContent: 0,
            duration: 2,
            ease: 'power2.out',
            snap: { textContent: 1 },
            scrollTrigger: {
              trigger: card,
              start: 'top 75%',
            },
            onUpdate: function() {
              counter.textContent = Math.round(gsap.getProperty(counter, 'textContent') as number).toString();
            }
          });
        }
      }
    });

    // Parallax effect for grid items on scroll
    gsap.to(gridRef.current, {
      y: -50,
      ease: 'none',
      scrollTrigger: {
        trigger: gridRef.current,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      }
    });

  }, { scope: container });

  return (
    <section ref={container} className="w-full px-6 relative overflow-hidden py-20">
      {/* Animated background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="orb-bg absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-[120px]" />
        <div className="orb-bg absolute top-1/2 right-1/4 h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[150px]" />
        <div className="orb-bg absolute bottom-0 left-1/2 h-[400px] w-[400px] rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>

      <div className="mx-auto max-w-6xl relative z-10">
        {/* Header */}
        <div className="mb-16">
          <h2
            ref={titleRef}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6"
            style={{ transformStyle: 'preserve-3d' }}
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
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:auto-rows-[180px] auto-rows-[minmax(140px,auto)]"
        >
          {bentoItems.map((item, index) => (
            <BentoCard
              key={index}
              item={item}
              index={index}
              cardRef={(el) => { cardRefs.current[index] = el; }}
              spotlightRef={(el) => { spotlightRefs.current[index] = el; }}
              iconRef={(el) => { iconRefs.current[index] = el; }}
              counterRef={(el) => { counterRefs.current[index] = el; }}
              onMouseMove={handleMouseMove(index)}
              onMouseLeave={handleMouseLeave(index)}
              isHovered={hoveredIndex === index}
            />
          ))}
        </div>
      </div>

      {/* Bottom decorative gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none" />
    </section>
  );
}
