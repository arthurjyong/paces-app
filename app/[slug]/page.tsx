// Public SEO revision landing pages, served at the top level (/systemic-sclerosis,
// /paces-respiratory, /paces-format, …). Statically prerendered at build from the
// authored JSON in content/landing/ (which ships from local disk, not the repo).
//
// dynamicParams = false: ONLY the slugs enumerated by generateStaticParams
// render — every other top-level path 404s, so this catch-all never shadows a
// real route (/about, /privacy, /api/* are explicit and always win) or serves a
// junk URL. These pages carry no hidden case material (invariant 1): they are
// revision content ABOUT named conditions, decoupled from the opaque case bank.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import LandingPageView from '@/components/LandingPageView';
import { getLandingPage, getLandingSlugs, resolveRelated } from '@/lib/content';
import { pageMetadata, landingGraphLd, faqPageLd } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return getLandingSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getLandingPage(slug);
  if (!page) return {};
  return pageMetadata({ title: page.title, description: page.metaDescription, path: `/${slug}` });
}

export default async function LandingRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getLandingPage(slug);
  if (!page) notFound();

  return (
    <>
      <JsonLd
        data={landingGraphLd({
          slug: page.slug,
          kind: page.kind,
          title: page.title,
          description: page.metaDescription,
          name: page.h1,
        })}
      />
      {page.faq && page.faq.length > 0 && <JsonLd data={faqPageLd(page.faq)} />}
      <LandingPageView page={page} related={resolveRelated(page)} />
    </>
  );
}
