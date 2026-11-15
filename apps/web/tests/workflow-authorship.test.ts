import { describe, expect, it } from 'vitest';
import { authorshipOf, takeoverNote } from '../src/components/workflows/authorship';

/**
 * What the harness records on a workflow an agent wrote (felix-run/felix#667, #671), read back:
 * `authored_via` names the agent and whether its person has saved it since, and `created_by` is
 * that person's issuer-qualified key.
 */
describe('authorshipOf', () => {
  it('reads an agent workflow, and one its person has edited since', () => {
    expect(
      authorshipOf({ created_by: 'https://iss.example|ada', authored_via: 'agent:quick' }),
    ).toEqual({
      agent: 'quick',
      person: 'ada',
      ownerEdited: false,
    });
    expect(
      authorshipOf({ created_by: 'https://iss.example|ada', authored_via: 'owner:agent:quick' }),
    ).toEqual({
      agent: 'quick',
      person: 'ada',
      ownerEdited: true,
    });
  });

  it('keeps a subject that holds its own bar whole: only an issuer never does', () => {
    expect(
      authorshipOf({
        created_by: 'https://tenant.auth0.com/|auth0|123',
        authored_via: 'agent:quick',
      })?.person,
    ).toBe('auth0|123');
  });

  it('is nothing for a person’s workflow, an older harness, or a malformed mark', () => {
    expect(authorshipOf({ created_by: 'ops', authored_via: '' })).toBeNull();
    expect(authorshipOf({})).toBeNull();
    expect(authorshipOf({ created_by: 'x|y', authored_via: 'agent:' })).toBeNull();
    expect(authorshipOf({ created_by: 'x|y', authored_via: 'someone:agent:quick' })).toBeNull();
  });
});

describe('takeoverNote', () => {
  it('warns only while the agent still holds it: once its person has saved it, a save changes nothing for the agent', () => {
    const held = authorshipOf({ created_by: 'i|ada', authored_via: 'agent:quick' });
    expect(takeoverNote(held)).toContain(
      'the agent will no longer change it, and will still run it only if you are ada',
    );
    expect(
      takeoverNote(authorshipOf({ created_by: 'i|ada', authored_via: 'owner:agent:quick' })),
    ).toBeNull();
    expect(takeoverNote(null)).toBeNull();
  });
});
