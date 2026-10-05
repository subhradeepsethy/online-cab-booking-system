// Shared class recipes so buttons and inputs look identical everywhere, including on <Link>s.
const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const buttonVariants = {
  primary: 'bg-ink text-white hover:bg-ink-2',
  secondary: 'border border-line bg-white text-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  danger: 'bg-danger text-white hover:bg-[#a51f1f]',
  brand: 'bg-brand text-white hover:bg-[#0b8549]',
};

const buttonSizes = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};

export function buttonClasses({ variant = 'primary', size = 'md', block = false } = {}) {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${block ? 'w-full' : ''}`;
}

export const inputClasses = 'h-12 w-full rounded-lg border border-line bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-subtle focus:border-ink focus:ring-4 focus:ring-ink/5';

export const vehicleIcon = { bike: 'bike', auto: 'auto', mini: 'car', sedan: 'car', suv: 'suv' };

export const paymentIcon = { cash: 'cash', upi: 'upi', card: 'card' };

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
