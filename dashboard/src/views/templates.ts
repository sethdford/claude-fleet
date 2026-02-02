/**
 * Templates View
 * CRUD for reusable task/workflow templates.
 * Route: #/templates
 */

import toast from '@/components/toast';
import { confirm } from '@/components/confirm';
import { escapeHtml } from '@/utils/escape-html';
import {
  getTemplates,
  createTemplate,
  deleteTemplate,
  executeTemplate,
} from '@/api-operations';
import type { Template } from '@/types';

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export async function renderTemplates(container: HTMLElement): Promise<() => void> {
  let templates: Template[] = [];

  async function loadTemplates(): Promise<void> {
    try {
      templates = await getTemplates();
      if (!Array.isArray(templates)) templates = [];
    } catch {
      templates = [];
    }
    render();
  }

  function render(): void {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Templates</h2>
          <button class="btn btn-primary btn-sm" id="create-template">+ Create Template</button>
        </div>

        ${templates.length === 0 ? `
          <div class="empty-state p-xl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="size-8">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M12 8v8M8 12h8"/>
            </svg>
            <div class="empty-state-title">No Templates</div>
            <div class="empty-state-text">Create reusable templates for common tasks</div>
          </div>
        ` : `
          <div class="grid grid-cols-2 gap-md p-md">
            ${templates.map((t) => `
              <div class="card template-card" data-template-id="${escapeHtml(t.id)}">
                <div class="flex items-start justify-between mb-sm">
                  <div>
                    <h3 class="text-[15px] font-semibold text-fg m-0">${escapeHtml(t.name)}</h3>
                    ${t.description ? `<p class="text-xs text-fg-secondary mt-xs">${escapeHtml(t.description.slice(0, 120))}</p>` : ''}
                  </div>
                  ${t.category ? `<span class="badge">${escapeHtml(t.category)}</span>` : ''}
                </div>
                <div class="flex gap-md text-xs text-fg-muted mb-md">
                  ${t.estimatedMinutes ? `<span>\u23F1 ~${t.estimatedMinutes}m</span>` : ''}
                  ${t.role ? `<span>\u{1F464} ${escapeHtml(t.role)}</span>` : ''}
                </div>
                <div class="flex gap-sm">
                  <button class="btn btn-primary btn-sm run-template">Run</button>
                  <button class="btn btn-danger btn-sm delete-template">\u2715 Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  await loadTemplates();

  // Event delegation
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Create template
    if (target.closest('#create-template')) {
      const name = prompt('Template name:');
      if (!name) return;
      const description = prompt('Description (optional):') || undefined;
      const category = prompt('Category (optional):') || undefined;
      try {
        await createTemplate({ name, description, category });
        toast.success('Template created');
        await loadTemplates();
      } catch (err) {
        toast.error((err as Error).message);
      }
      return;
    }

    // Run template
    const runBtn = target.closest('.run-template') as HTMLElement | null;
    if (runBtn) {
      const card = runBtn.closest('[data-template-id]') as HTMLElement | null;
      const templateId = card?.dataset.templateId;
      if (templateId) {
        try {
          await executeTemplate(templateId);
          toast.success('Template executed');
        } catch (err) {
          toast.error((err as Error).message);
        }
      }
      return;
    }

    // Delete template
    const delBtn = target.closest('.delete-template') as HTMLElement | null;
    if (delBtn) {
      const card = delBtn.closest('[data-template-id]') as HTMLElement | null;
      const templateId = card?.dataset.templateId;
      if (templateId) {
        const confirmed = await confirm({
          title: 'Delete Template',
          message: 'Are you sure you want to delete this template?',
          confirmText: 'Delete',
          variant: 'danger',
        });
        if (confirmed) {
          try {
            await deleteTemplate(templateId);
            toast.success('Template deleted');
            await loadTemplates();
          } catch (err) {
            toast.error((err as Error).message);
          }
        }
      }
    }
  });

  return () => {};
}
