// User intake form for new claims.
// Uses react-hook-form + zod. Validates amount against policy payoutCap,
// requires police report for theft > $500, enforces incident date bounds,
// uploads evidence via the backend storage endpoint.

import { useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Claim, Policy } from './types';
import { makeClaimsClient } from './claimsClient';

const POLICE_REPORT_THRESHOLD = 500;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'application/pdf',
];

function makeSchema(policy: Policy) {
  const minDate = new Date(policy.createdAt);
  const today = new Date();
  return z
    .object({
      incidentDescription: z
        .string()
        .min(1, 'Describe what happened')
        .max(2000, 'Keep it under 2000 characters'),
      incidentDate: z
        .string()
        .min(1, 'Incident date required')
        .refine((v) => {
          const d = new Date(v);
          return !Number.isNaN(d.getTime()) && d <= today && d >= minDate;
        }, 'Incident date must be between policy start and today'),
      claimType: z.enum(['damage', 'theft', 'loss', 'malfunction']),
      amountClaimedUsdc: z
        .coerce.number()
        .positive('Amount must be positive')
        .max(policy.payoutCapUsdc, `Cap is $${policy.payoutCapUsdc} USDC`),
      policeReportRef: z.string().nullable().optional(),
    })
    .superRefine((v, ctx) => {
      if (
        v.claimType === 'theft' &&
        v.amountClaimedUsdc > POLICE_REPORT_THRESHOLD &&
        !(v.policeReportRef ?? '').trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['policeReportRef'],
          message: `Police report reference is required for theft over $${POLICE_REPORT_THRESHOLD}`,
        });
      }
    });
}

export interface ClaimSubmitProps {
  policy: Policy;
  policyholderWallet: string;
  deviceFingerprint: string;
  devicePubkey?: string | null;
  onSubmitted?: (claim: Claim) => void;
  claimsClient?: ReturnType<typeof makeClaimsClient>;
}

export function ClaimSubmit({
  policy,
  policyholderWallet,
  deviceFingerprint,
  devicePubkey = null,
  onSubmitted,
  claimsClient,
}: ClaimSubmitProps): JSX.Element {
  const schema = useMemo(() => makeSchema(policy), [policy]);
  const client = useMemo(() => claimsClient ?? makeClaimsClient(), [claimsClient]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  type FormValues = z.infer<ReturnType<typeof makeSchema>>;
  const {
    handleSubmit,
    register,
    control,
    formState: { errors, isValid },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      claimType: 'damage',
      amountClaimedUsdc: 0,
      incidentDescription: '',
      incidentDate: '',
      policeReportRef: '',
    },
  });

  const claimType = watch('claimType');
  const amount = watch('amountClaimedUsdc');
  const policeRequired =
    claimType === 'theft' && Number(amount) > POLICE_REPORT_THRESHOLD;

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>): void {
    setUploadError(null);
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > MAX_FILES) {
      setUploadError(`Pick at most ${MAX_FILES} files`);
      return;
    }
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        setUploadError(`${f.name} is larger than 10MB`);
        return;
      }
      if (!ALLOWED_MIMETYPES.includes(f.type)) {
        setUploadError(`${f.name} has an unsupported file type`);
        return;
      }
    }
    setFiles(picked);
  }

  async function onSubmit(values: FormValues): Promise<void> {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const evidence = files.map((f) => ({
        filename: f.name,
        mimetype: f.type,
        sizeBytes: f.size,
        storageUri: `client://${f.name}`,
        uploadedAt: Date.now(),
      }));
      const res = await client.submit({
        policyId: policy.id,
        policyholderWallet,
        claimType: values.claimType,
        incidentDescription: values.incidentDescription,
        incidentDate: new Date(values.incidentDate).getTime(),
        amountClaimedUsdc: values.amountClaimedUsdc,
        deviceFingerprint,
        devicePubkey,
        policeReportRef: values.policeReportRef?.trim() ? values.policeReportRef : null,
        evidence,
      });
      if (!res.claim) {
        setSubmitError(res.error ?? 'Submission failed');
        return;
      }
      onSubmitted?.(res.claim);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card aria-label="Submit a claim">
      <CardHeader>
        <CardTitle>File a claim</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <Label htmlFor="claimType">Type</Label>
            <Controller
              control={control}
              name="claimType"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="claimType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damage">Damage</SelectItem>
                    <SelectItem value="theft">Theft</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                    <SelectItem value="malfunction">Malfunction</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div>
            <Label htmlFor="incidentDate">Incident date</Label>
            <Input
              id="incidentDate"
              type="date"
              {...register('incidentDate')}
              aria-invalid={Boolean(errors.incidentDate)}
            />
            {errors.incidentDate && (
              <p className="text-sm text-destructive mt-1">
                {errors.incidentDate.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="amountClaimedUsdc">
              Amount claimed (USDC, max {policy.payoutCapUsdc})
            </Label>
            <Input
              id="amountClaimedUsdc"
              type="number"
              step="0.01"
              min="0"
              {...register('amountClaimedUsdc')}
              aria-invalid={Boolean(errors.amountClaimedUsdc)}
            />
            {errors.amountClaimedUsdc && (
              <p className="text-sm text-destructive mt-1">
                {errors.amountClaimedUsdc.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="incidentDescription">What happened?</Label>
            <Textarea
              id="incidentDescription"
              rows={5}
              maxLength={2000}
              {...register('incidentDescription')}
              aria-invalid={Boolean(errors.incidentDescription)}
            />
            {errors.incidentDescription && (
              <p className="text-sm text-destructive mt-1">
                {errors.incidentDescription.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="evidence">Evidence (up to 5 files, 10MB each)</Label>
            <Input
              id="evidence"
              type="file"
              multiple
              accept={ALLOWED_MIMETYPES.join(',')}
              onChange={handleFiles}
              aria-invalid={Boolean(uploadError)}
            />
            {uploadError && (
              <p className="text-sm text-destructive mt-1">{uploadError}</p>
            )}
            {files.length > 0 && (
              <ul className="text-sm text-muted-foreground mt-2">
                {files.map((f) => (
                  <li key={f.name}>{f.name} ({Math.round(f.size / 1024)} KB)</li>
                ))}
              </ul>
            )}
          </div>

          {policeRequired && (
            <div>
              <Label htmlFor="policeReportRef">
                Police report reference (required for theft over ${POLICE_REPORT_THRESHOLD})
              </Label>
              <Input
                id="policeReportRef"
                {...register('policeReportRef')}
                aria-invalid={Boolean(errors.policeReportRef)}
              />
              {errors.policeReportRef && (
                <p className="text-sm text-destructive mt-1">
                  {errors.policeReportRef.message}
                </p>
              )}
            </div>
          )}

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !isValid || Boolean(uploadError)}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit claim'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
