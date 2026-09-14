import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'dark';
export type ButtonSize = 'small' | 'default' | 'large';

function classes(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return [
    'button',
    variant !== 'secondary' ? variant : '',
    size !== 'default' ? size : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
};

/** Button — primary/secondary/quiet/dark, three sizes. Renders a real <button>. */
export function Button({
  variant = 'secondary',
  size = 'default',
  children,
  className,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classes(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

/** ButtonLink — same look as Button, renders a Next.js <Link> (internal href) or <a>. */
export function ButtonLink({
  variant = 'secondary',
  size = 'default',
  children,
  className,
  href,
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const external = /^https?:\/\//.test(href);
  if (external) {
    return (
      <a className={classes(variant, size, className)} href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link className={classes(variant, size, className)} href={href} {...rest}>
      {children}
    </Link>
  );
}
