import React from 'react';

export const SkeletonRow: React.FC<{ columns?: number }> = ({ columns = 8 }) => (
  <tr className="bg-white border-b border-slate-100">
    {Array.from({ length: columns }).map((_, i) => (
      <td key={i} className="px-6 py-4">
        <div className="h-4 bg-slate-200 rounded animate-pulse"></div>
      </td>
    ))}
  </tr>
);

export const SkeletonTableBody: React.FC<{ rows?: number; columns?: number }> = ({ rows = 8, columns = 8 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonRow key={i} columns={columns} />
    ))}
  </>
);

export const SkeletonHeader: React.FC<{ columns?: number }> = ({ columns = 8 }) => (
  <tr className="bg-slate-50 border-b border-slate-200">
    {Array.from({ length: columns }).map((_, i) => (
      <th key={i} className="px-6 py-4">
        <div className="h-4 bg-slate-300 rounded animate-pulse"></div>
      </th>
    ))}
  </tr>
);

export const SkeletonFilterPanel: React.FC = () => (
  <div className="border-b border-slate-100 bg-slate-50/50 p-6">
    <div className="flex items-center justify-between mb-6">
      <div className="h-6 bg-slate-300 rounded w-40 animate-pulse"></div>
      <div className="h-6 bg-slate-200 rounded w-24 animate-pulse"></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 bg-slate-300 rounded w-24 animate-pulse"></div>
          <div className="h-10 bg-slate-200 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  </div>
);

export const SkeletonCard: React.FC = () => (
  <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
    <div className="h-4 bg-slate-300 rounded w-32 mb-3 animate-pulse"></div>
    <div className="h-8 bg-slate-200 rounded w-24 animate-pulse"></div>
  </div>
);

export const SkeletonAnalytics: React.FC<{ cards?: number }> = ({ cards = 9 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {Array.from({ length: cards }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);
