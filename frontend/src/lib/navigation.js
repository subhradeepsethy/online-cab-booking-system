export const riderLinks = [
  { to: '/rider', label: 'Ride' },
  { to: '/rider/trips', label: 'Activity' },
];

export const driverLinks = [
  { to: '/driver', label: 'Drive' },
  { to: '/driver/trips', label: 'Earnings' },
  { to: '/driver/documents', label: 'Documents' },
];

export const driverRoleLabel = (user) => `${user.driver.vehicleNumber} · ${user.driver.vehicleType.toUpperCase()}`;
