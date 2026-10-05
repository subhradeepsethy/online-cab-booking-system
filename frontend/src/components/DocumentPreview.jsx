import { useEffect, useState } from 'react';
import { fetchFileBlob } from '../lib/apiClient.js';
import Icon from './Icon.jsx';
import { Spinner } from './ui.jsx';

// Loads a protected document using the role's session and shows it (image inline, PDF as a link).
function DocumentPreview({ path, role, mimeType, label, className = 'h-40' }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl;
    let isMounted = true;
    setUrl(null);
    setError('');

    fetchFileBlob(path, role)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (isMounted) setUrl(objectUrl);
      })
      .catch((loadError) => {
        if (isMounted) setError(loadError.message);
      });

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, role]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!url) return <div className={`flex items-center justify-center rounded-lg bg-canvas text-muted ${className}`}><Spinner /></div>;

  if (mimeType === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`flex flex-col items-center justify-center gap-2 rounded-lg bg-canvas text-sm font-medium hover:bg-line ${className}`}>
        <Icon name="receipt" className="h-6 w-6" />
        Open PDF
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" title={`Open ${label}`}>
      <img src={url} alt={label} className={`w-full rounded-lg bg-canvas object-contain ${className}`} />
    </a>
  );
}

export default DocumentPreview;
