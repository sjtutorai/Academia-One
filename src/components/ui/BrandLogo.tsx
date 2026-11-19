import React from 'react';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  subtitle?: string;
  tone?: 'light' | 'dark';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, { box: string; title: string; subtitle: string }> = {
  xs: { box: 'h-7 w-7 rounded-lg p-0.5', title: 'text-sm', subtitle: 'text-[10px]' },
  sm: { box: 'h-8 w-8 rounded-lg p-0.5', title: 'text-base', subtitle: 'text-[10px]' },
  md: { box: 'h-9 w-9 rounded-xl p-0.5', title: 'text-lg', subtitle: 'text-[11px]' },
  lg: { box: 'h-11 w-11 rounded-xl p-1', title: 'text-xl', subtitle: 'text-xs' },
  xl: { box: 'h-14 w-14 rounded-2xl p-1', title: 'text-2xl', subtitle: 'text-xs' },
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
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${s.box} ${
          isDark
            ? 'ring-1 ring-white/20 shadow-sm'
            : 'ring-1 ring-slate-200/90 shadow-xs'
        }`}
      >
        <img
          src="/logo.png"
          alt="AcademiaOne"
          className="h-full w-full object-contain"
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
            AcademiaOne
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
