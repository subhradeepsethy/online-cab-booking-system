import Icon from './Icon.jsx';

const badgeStyles = {
  approved: { className: 'bg-brand-soft text-[#0b6b3c]', icon: 'shield', label: 'Verified' },
  pending: { className: 'bg-warning-soft text-warning', icon: 'clock', label: 'Under review' },
  rejected: { className: 'bg-danger-soft text-danger', icon: 'close', label: 'Action needed' },
};

function VerificationBadge({ status }) {
  const style = badgeStyles[status] ?? badgeStyles.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${style.className}`}>
      <Icon name={style.icon} className="h-4 w-4" />
      {style.label}
    </span>
  );
}

export default VerificationBadge;
