# @gears-frontx/routing

FrontX's navigation library: one browser navigation history and one URL grammar shared by a
composed application and every independently bundled microfrontend it contains, plus a signal
naming which extension(s) own a given extension domain's entries. Framework-agnostic and
engine-agnostic by constraint — no dependency on any concrete router engine or UI framework; a
separately published engine-provider package binds this substrate to one.

Every extension domain, at any depth, is addressed through the same entry grammar. The model task
(ADR-0003 example 7.1) reads in the address bar as one line:

```
/en?screen=dashboard;orientation=left&sheet=tenant-details;tenantId=456
   &sheet=user-contacts;contactId=123;view=active&widgets=line-a;range=7d
   &widgets=line-b;range=30d&widgets=pie;metric=revenue
```

See `architecture/` for the requirements (PRD), structure and constraints (DESIGN), the decisions
behind the grammar (ADR), and the behavior each FEATURE specifies.

## License

Apache-2.0. `LICENSE` and `NOTICE` ship inside the package.
