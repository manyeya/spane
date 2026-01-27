import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { BentoFeatures } from '@/components/landing/BentoFeatures';
import { CodePreview } from '@/components/landing/CodePreview';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { Footer } from '@/components/landing/Footer';

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-black text-white antialiased selection:bg-blue-500/30">
      {/* Universal Spotlight - page level, behind everything */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-[10%] left-1/2 -translate-x-1/2 h-[80vh] w-[100vw] rounded-full bg-gradient-to-b from-blue-400/30 via-purple-400/20 to-transparent blur-[100px]" />
      </div>

      <Hero />
      <HowItWorks />
      <BentoFeatures />
      <Features />
      <CodePreview />
      <FinalCTA />
      <Footer />
    </main>
  );
}
