import { useEffect, useState } from 'react';
import { api } from '../api';
import { RESULT, STATUS } from '../lib/domain';
import { formatDate } from '../lib/format';
import type { DownstreamImpact } from '../types';
import { Alert, Badge, Loading, TableWrap, TD, TH } from '../ui';

/** §7.10: verifications that used this equipment as reference since its last valid verification. */
export default function DownstreamImpactView({
  equipmentId,
  onOpenVerification,
}: {
  equipmentId: string;
  onOpenVerification: (id: string) => void;
}) {
  const [data, setData] = useState<DownstreamImpact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    api
      .downstreamImpact(equipmentId)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [equipmentId]);

  if (error) return <Alert tone="red">{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">
        {data.since
          ? `Verificaciones hechas con ${data.internalCode} como patrón desde ${formatDate(data.since)}.`
          : `${data.internalCode} no tiene verificación vigente: se listan todas las verificaciones hechas con él como patrón.`}
      </p>
      {data.items.length === 0 ? (
        <p className="text-sm text-gray-500">Ningún equipo afectado.</p>
      ) : (
        <TableWrap>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={TH}>Candidato</th>
                <th className={TH}>Fecha</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Resultado</th>
                <th className={TH}>Vigente hasta</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.verificationId} className="cursor-pointer hover:bg-blue-50/40" onClick={() => onOpenVerification(i.verificationId)}>
                  <td className={`${TD} font-semibold text-blue-700`}>{i.candidateInternalCode}</td>
                  <td className={TD}>{formatDate(i.verificationDate)}</td>
                  <td className={TD}>
                    <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                  </td>
                  <td className={TD}>{i.overallResult ? <Badge tone={RESULT[i.overallResult].tone}>{RESULT[i.overallResult].label}</Badge> : '—'}</td>
                  <td className={TD}>{formatDate(i.validUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
