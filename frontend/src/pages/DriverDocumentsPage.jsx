import { useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import DocumentPreview from '../components/DocumentPreview.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Card, Spinner } from '../components/ui.jsx';
import { readFileAsBase64 } from '../lib/apiClient.js';
import { formatDateTime } from '../lib/format.js';
import { useApi, useSession } from '../lib/session.js';
import { buttonClasses } from '../lib/ui.js';
import { useRealtime } from '../lib/useRealtime.js';
import VerificationBadge from '../components/VerificationBadge.jsx';
import { driverLinks, driverRoleLabel } from '../lib/navigation.js';

const maxBytes = 3 * 1024 * 1024;
const accepted = 'image/jpeg,image/png,image/webp,application/pdf';

function DocumentRow({ type, document, onUpload, isUploading }) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${document.uploaded ? 'bg-brand-soft text-brand' : 'bg-canvas text-muted'}`}>
            <Icon name={document.uploaded ? 'check' : 'receipt'} className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">{document.label}</p>
            <p className="text-sm text-muted">
              {document.uploaded ? `${document.fileName} · uploaded ${formatDateTime(document.uploadedAt)}` : 'Not uploaded yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {document.uploaded ? (
            <button type="button" onClick={() => setShowPreview((current) => !current)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              {showPreview ? 'Hide' : 'View'}
            </button>
          ) : null}
          <label className={`${buttonClasses({ variant: document.uploaded ? 'secondary' : 'primary', size: 'sm' })} cursor-pointer ${isUploading ? 'pointer-events-none opacity-50' : ''}`}>
            {isUploading ? <Spinner /> : null}
            {document.uploaded ? 'Replace' : 'Upload'}
            <input
              type="file"
              accept={accepted}
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onUpload(type, file);
              }}
            />
          </label>
        </div>
      </div>
      {showPreview && document.uploaded ? (
        <div className="mt-4 max-w-md">
          <DocumentPreview
            path={`/driver/documents/${type}/file?v=${encodeURIComponent(document.uploadedAt)}`}
            role="driver"
            mimeType={document.mimeType}
            label={document.label}
            className="h-56"
          />
        </div>
      ) : null}
    </div>
  );
}

function DriverDocumentsPage() {
  const { user, signOut, updateUser } = useSession('driver');
  const api = useApi('driver');
  const [uploadingType, setUploadingType] = useState(null);
  const [notice, setNotice] = useState(null);
  const status = user.driver.approvalStatus;

  useRealtime('driver', {
    'account:changed': () => api('/auth/me').then((result) => updateUser(result.user)).catch(() => {}),
  });

  const upload = async (type, file) => {
    setNotice(null);
    if (file.size > maxBytes) {
      setNotice({ tone: 'error', text: 'Files must be 3 MB or smaller.' });
      return;
    }

    setUploadingType(type);
    try {
      const dataBase64 = await readFileAsBase64(file);
      const result = await api(`/driver/documents/${type}`, {
        method: 'PUT',
        body: { fileName: file.name, mimeType: file.type, dataBase64 },
      });
      updateUser(result.user);
      setNotice({ tone: 'success', text: `${user.driver.documents[type].label} uploaded.` });
    } catch (uploadError) {
      setNotice({ tone: 'error', text: uploadError.message });
    } finally {
      setUploadingType(null);
    }
  };

  const missing = Object.values(user.driver.documents).filter((document) => !document.uploaded).length;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader links={driverLinks} user={user} onSignOut={signOut} roleLabel={driverRoleLabel(user)} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
            <p className="mt-1 text-muted">Upload clear photos or PDFs. Our team verifies them before you can take trips.</p>
          </div>
          <VerificationBadge status={status} />
        </div>

        <div className="mt-6 grid gap-3">
          {status === 'rejected' && user.driver.approvalNote ? (
            <Alert tone="error">Your documents were not approved: {user.driver.approvalNote} Upload corrected documents to be reviewed again.</Alert>
          ) : null}
          {status === 'pending' && missing > 0 ? (
            <Alert tone="warning">Upload {missing} more document{missing > 1 ? 's' : ''} to send your account for review.</Alert>
          ) : null}
          {status === 'pending' && missing === 0 ? (
            <Alert tone="success">All documents received. We&apos;ll notify you here as soon as they&apos;re reviewed.</Alert>
          ) : null}
          {status === 'approved' ? (
            <Alert tone="success">You&apos;re verified. Replacing a document will send your account for review again.</Alert>
          ) : null}
          {notice ? <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert> : null}
        </div>

        <Card className="mt-6 divide-y divide-line">
          {Object.entries(user.driver.documents).map(([type, document]) => (
            <DocumentRow key={type} type={type} document={document} onUpload={upload} isUploading={uploadingType === type} />
          ))}
        </Card>
        <p className="mt-3 text-xs text-muted">Accepted formats: JPG, PNG, WEBP or PDF, up to 3 MB each.</p>
      </main>
    </div>
  );
}

export default DriverDocumentsPage;
