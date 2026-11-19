import { Fragment } from 'react';
import type { Link } from '../api';
import { formatDate } from '../format';

type Site = NonNullable<Link['site']>;

/** The names the sites go by; a retriever not listed shows its own name, capitalised. */
const SITE_NAMES: Record<string, string> = { github: 'GitHub', youtube: 'YouTube' };

/** The name of the site a link was retrieved from, such as "GitHub". */
export function siteName(site: Site): string {
  return (
    SITE_NAMES[site.retriever] ?? site.retriever.charAt(0).toUpperCase() + site.retriever.slice(1)
  );
}

/** A fact as the card shows it: a repository's stars with a star. */
function cardValue(fact: Site['facts'][number]): string {
  return fact.key === 'stars' ? `★ ${fact.value}` : fact.value;
}

/** The facts a link's card shows, at most 3, each as one item of the card's facts line. */
export function CardFacts({ link }: { link: Link }) {
  const facts = link.site?.facts.filter((f) => f.card).slice(0, 3) ?? [];
  return (
    <>
      {facts.map((fact) => (
        <span key={fact.key} className="site-fact" title={fact.label}>
          {cardValue(fact)}
        </span>
      ))}
    </>
  );
}

/**
 * The detail page's section of what a retriever stored: the site's
 * description of the link, every fact by its label, the thumbnail as an
 * image, and when the link was retrieved.
 */
export function SiteSection({ site, description }: { site: Site; description: string | null }) {
  const heading = `From ${siteName(site)}`;
  return (
    <section aria-labelledby="site-heading">
      <h2 id="site-heading">{heading}</h2>
      {description && <p className="site-description">{description}</p>}
      <dl className="facts">
        {site.facts.map((fact) => (
          <Fragment key={fact.key}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.key === 'thumbnail' ? (
                <img className="site-thumbnail" src={fact.value} alt="" loading="lazy" />
              ) : (
                fact.value
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
      <p className="muted">Retrieved {formatDate(site.retrieved_at)}</p>
    </section>
  );
}
