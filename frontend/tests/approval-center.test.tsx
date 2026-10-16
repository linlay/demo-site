import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { DemoRepository } from '../src/common/store/repository';
import ApprovalCenterPage from '../src/pc/pages/ApprovalCenterPage';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing expected element');
  return value;
}

it('filters requests, opens a detail without an identity hint and approves only checked requests', async () => {
  const repository = new DemoRepository();
  const container = document.createElement('div');
  const root = createRoot(container);
  const navigate = vi.fn();
  try {
    await act(async () => root.render(<ApprovalCenterPage repository={repository} navigate={navigate} />));
    expect(container.textContent).toContain('我的待办');
    const pending = repository
      .snapshot()
      .officeApprovalRequests.filter((r) => r.reviewerId === 'EMP-002' && r.status === 'submitted');
    expect(pending.length).toBeGreaterThan(0);
    const link = required(container.querySelector<HTMLAnchorElement>('tbody a'));
    await act(async () => link.click());
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/scenes\/O08\/objects\/[^?]+$/));
    const checkbox = required(container.querySelector<HTMLInputElement>(`input[aria-label="事项 ${pending[0].id}"]`));
    await act(async () =>
      Simulate.change(checkbox, { target: { checked: true } } as unknown as Parameters<typeof Simulate.change>[1])
    );
    const batch = required(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '批量同意'));
    expect(batch.disabled).toBe(true);
    const input = required(container.querySelector<HTMLInputElement>('input[maxlength="200"]'));
    await act(async () =>
      Simulate.change(input, { target: { value: '资料齐全，同意。' } } as unknown as Parameters<
        typeof Simulate.change
      >[1])
    );
    await act(async () => batch.click());
    expect(repository.snapshot().officeApprovalRequests.find((r) => r.id === pending[0].id)?.status).toBe('approved');
    for (const row of pending.slice(1))
      expect(repository.snapshot().officeApprovalRequests.find((r) => r.id === row.id)?.status).toBe('submitted');
    const done = required(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) =>
        b.textContent?.includes('我的已办')
      )
    );
    await act(async () => done.click());
    expect(container.querySelector('tbody')?.textContent).toContain(pending[0].id);
    const summary = required(container.querySelector<HTMLInputElement>('form input'));
    await act(async () =>
      Simulate.change(summary, { target: { value: 'no-such-request' } } as unknown as Parameters<
        typeof Simulate.change
      >[1])
    );
    await act(async () => Simulate.submit(required(container.querySelector('form'))));
    expect(container.textContent).toContain('暂无匹配事项');
  } finally {
    await act(async () => root.unmount());
    sessionStorage.clear();
  }
});
