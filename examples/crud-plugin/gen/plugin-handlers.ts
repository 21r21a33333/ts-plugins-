import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateNoteRequest,
  DeleteNoteRequest,
  GetNoteRequest,
  InitRequest,
  ListNotesRequest,
  UpdateNoteRequest,
} from "@balance/plugin-generated/generated/balance/plugins/crud/v1/crud_plugin_pb";
import {
  CreateNoteRequestSchema,
  CreateNoteResponseSchema,
  DeleteNoteRequestSchema,
  DeleteNoteResponseSchema,
  GetNoteRequestSchema,
  GetNoteResponseSchema,
  InitRequestSchema,
  InitResponseSchema,
  ListNotesRequestSchema,
  ListNotesResponseSchema,
  UpdateNoteRequestSchema,
  UpdateNoteResponseSchema,
} from "@balance/plugin-generated/generated/balance/plugins/crud/v1/crud_plugin_pb";
import type { PluginContext } from "@balance/plugin-runtime";

export interface CrudPluginHandlers {
  init(req: InitRequest, ctx: PluginContext): MessageInitShape<typeof InitResponseSchema> | Promise<MessageInitShape<typeof InitResponseSchema>>;
  createNote(req: CreateNoteRequest, ctx: PluginContext): MessageInitShape<typeof CreateNoteResponseSchema> | Promise<MessageInitShape<typeof CreateNoteResponseSchema>>;
  getNote(req: GetNoteRequest, ctx: PluginContext): MessageInitShape<typeof GetNoteResponseSchema> | Promise<MessageInitShape<typeof GetNoteResponseSchema>>;
  updateNote(req: UpdateNoteRequest, ctx: PluginContext): MessageInitShape<typeof UpdateNoteResponseSchema> | Promise<MessageInitShape<typeof UpdateNoteResponseSchema>>;
  deleteNote(req: DeleteNoteRequest, ctx: PluginContext): MessageInitShape<typeof DeleteNoteResponseSchema> | Promise<MessageInitShape<typeof DeleteNoteResponseSchema>>;
  listNotes(req: ListNotesRequest, ctx: PluginContext): MessageInitShape<typeof ListNotesResponseSchema> | Promise<MessageInitShape<typeof ListNotesResponseSchema>>;
}

export const crudPluginMetadata = {
  packageName: "balance.plugins.crud.v1",
  serviceName: "CrudPluginService",
  typeName: "balance.plugins.crud.v1.CrudPluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/Init",
      methodId: 2618712115,
      inputType: "balance.plugins.crud.v1.InitRequest",
      outputType: "balance.plugins.crud.v1.InitResponse",
      inputSchema: InitRequestSchema,
      outputSchema: InitResponseSchema,
    },
    {
      name: "CreateNote",
      localName: "createNote",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/CreateNote",
      methodId: 2704122741,
      inputType: "balance.plugins.crud.v1.CreateNoteRequest",
      outputType: "balance.plugins.crud.v1.CreateNoteResponse",
      inputSchema: CreateNoteRequestSchema,
      outputSchema: CreateNoteResponseSchema,
    },
    {
      name: "GetNote",
      localName: "getNote",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/GetNote",
      methodId: 786590823,
      inputType: "balance.plugins.crud.v1.GetNoteRequest",
      outputType: "balance.plugins.crud.v1.GetNoteResponse",
      inputSchema: GetNoteRequestSchema,
      outputSchema: GetNoteResponseSchema,
    },
    {
      name: "UpdateNote",
      localName: "updateNote",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/UpdateNote",
      methodId: 1870412640,
      inputType: "balance.plugins.crud.v1.UpdateNoteRequest",
      outputType: "balance.plugins.crud.v1.UpdateNoteResponse",
      inputSchema: UpdateNoteRequestSchema,
      outputSchema: UpdateNoteResponseSchema,
    },
    {
      name: "DeleteNote",
      localName: "deleteNote",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/DeleteNote",
      methodId: 3256808630,
      inputType: "balance.plugins.crud.v1.DeleteNoteRequest",
      outputType: "balance.plugins.crud.v1.DeleteNoteResponse",
      inputSchema: DeleteNoteRequestSchema,
      outputSchema: DeleteNoteResponseSchema,
    },
    {
      name: "ListNotes",
      localName: "listNotes",
      canonicalName: "balance.plugins.crud.v1.CrudPluginService/ListNotes",
      methodId: 2412273470,
      inputType: "balance.plugins.crud.v1.ListNotesRequest",
      outputType: "balance.plugins.crud.v1.ListNotesResponse",
      inputSchema: ListNotesRequestSchema,
      outputSchema: ListNotesResponseSchema,
    },
  ],
} as const;
