import React from 'react';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  subtitle?: string;
  tone?: 'light' | 'dark';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, { box: string; title: string; subtitle: string }> = {
  xs: { box: 'h-7 w-7', title: 'text-sm', subtitle: 'text-[10px]' },
  sm: { box: 'h-8 w-8', title: 'text-base', subtitle: 'text-[10px]' },
  md: { box: 'h-9 w-9', title: 'text-lg', subtitle: 'text-[11px]' },
  lg: { box: 'h-11 w-11', title: 'text-xl', subtitle: 'text-xs' },
  xl: { box: 'h-14 w-14', title: 'text-2xl', subtitle: 'text-xs' },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showWordmark = true,
  subtitle,
  tone = 'light',
  className = '',
}) => {
  const s = SIZE_CLASSES[size];
  const isDark = tone === 'dark';

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <span className={`inline-flex shrink-0 items-center justify-center ${s.box}`}>
        <img
          src="/logo.png?v=2"
          alt="SJ Academia One"
          className={`h-full w-full object-contain ${isDark ? 'drop-shadow-[0_1px_4px_rgba(0,0,0,0.35)]' : ''}`}
          draggable={false}
        />
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-tight min-w-0">
          <span
            className={`font-display font-bold tracking-tight truncate ${s.title} ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            SJ Academia One
          </span>
          {subtitle && (
            <span
              className={`font-medium truncate ${s.subtitle} ${
                isDark ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
};
