/**
 * Basecamp API response types
 */

/** Todo item from Basecamp API */
export interface BasecampTodo {
  id: number;
  status: string;
  visible_to_clients: boolean;
  created_at: string;
  updated_at: string;
  title: string;
  inherits_status: boolean;
  type: string;
  url: string;
  app_url: string;
  bookmark_url: string;
  subscription_url: string;
  comments_count: number;
  comments_url: string;
  position: number;
  parent: {
    id: number;
    title: string;
    type: string;
    url: string;
    app_url: string;
  };
  bucket: {
    id: number;
    name: string;
    type: string;
  };
  creator: BasecampPerson;
  description: string;
  completed: boolean;
  content: string;
  starts_on: string | null;
  due_on: string | null;
  assignees: BasecampPerson[];
  completion_subscribers: BasecampPerson[];
  completion_url: string;
  comment_count: number;
}

/** Message from Basecamp API */
export interface BasecampMessage {
  id: number;
  status: string;
  visible_to_clients: boolean;
  created_at: string;
  updated_at: string;
  title: string;
  inherits_status: boolean;
  type: string;
  url: string;
  app_url: string;
  bookmark_url: string;
  subscription_url: string;
  comments_count: number;
  comments_url: string;
  parent: {
    id: number;
    title: string;
    type: string;
    url: string;
    app_url: string;
  };
  bucket: {
    id: number;
    name: string;
    type: string;
  };
  creator: BasecampPerson;
  content: string;
  subject: string;
}

/** Comment from Basecamp API */
export interface BasecampComment {
  id: number;
  status: string;
  visible_to_clients: boolean;
  created_at: string;
  updated_at: string;
  title: string;
  inherits_status: boolean;
  type: string;
  url: string;
  app_url: string;
  bookmark_url: string;
  parent: {
    id: number;
    title: string;
    type: string;
    url: string;
    app_url: string;
  };
  bucket: {
    id: number;
    name: string;
    type: string;
  };
  creator: BasecampPerson;
  content: string;
}

/** Person/user from Basecamp API */
export interface BasecampPerson {
  id: number;
  attachable_sgid: string;
  name: string;
  email_address: string;
  personable_type: string;
  title: string;
  bio: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
  admin: boolean;
  owner: boolean;
  client: boolean;
  employee: boolean;
  time_zone: string;
  avatar_url: string;
  company?: {
    id: number;
    name: string;
  };
  can_manage_projects: boolean;
  can_manage_people: boolean;
}

/** OAuth token response */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Authorization info from Basecamp */
export interface AuthorizationInfo {
  expires_at: string;
  identity: {
    id: number;
    first_name: string;
    last_name: string;
    email_address: string;
  };
  accounts: Array<{
    id: number;
    name: string;
    product: string;
    href: string;
    app_href: string;
  }>;
}
