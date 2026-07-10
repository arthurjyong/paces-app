// Renders a JSON-LD structured-data block. Per the Next.js json-ld guide, use a
// native <script type="application/ld+json"> (NOT next/script — that is for
// executable JS), and escape '<' to defuse XSS from any string value.
// Server component; must be rendered from a Server Component (e.g. app/page is
// a server wrapper, app/about is static).

export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
