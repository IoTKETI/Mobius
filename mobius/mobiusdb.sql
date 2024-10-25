--
-- PostgreSQL database dump
--

-- Dumped from database version 16.3
-- Dumped by pg_dump version 16.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acp; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acp (
    pv text,
    pvs text,
    ri character varying(200) NOT NULL
);


ALTER TABLE public.acp OWNER TO postgres;

--
-- Name: ae; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ae (
    ri character varying(200) NOT NULL,
    apn character varying(50) NOT NULL,
    api character varying(50) NOT NULL,
    aei character varying(200) NOT NULL,
    poa character varying(200) NOT NULL,
    "or" character varying(50) NOT NULL,
    rr character varying(50) NOT NULL,
    nl character varying(50) NOT NULL,
    csz character varying(50),
    srv character varying(50)
);


ALTER TABLE public.ae OWNER TO postgres;

--
-- Name: cb; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cb (
    cst integer DEFAULT 1 NOT NULL,
    csi character varying(50) NOT NULL,
    nl character varying(50) NOT NULL,
    ncp character varying(50) NOT NULL,
    srv character varying(50),
    ri character varying(200) NOT NULL,
    poa character varying(200) NOT NULL,
    srt character varying(200) NOT NULL
);


ALTER TABLE public.cb OWNER TO postgres;

--
-- Name: cin; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cin (
    ri character varying(200) NOT NULL,
    cnf character varying(50) NOT NULL,
    "or" character varying(50) NOT NULL,
    con text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.cin OWNER TO postgres;

--
-- Name: cnt; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cnt (
    ri character varying(200) NOT NULL,
    mni bigint DEFAULT 10000000 NOT NULL,
    mbs bigint DEFAULT 1073741824 NOT NULL,
    mia integer,
    cni integer DEFAULT 0 NOT NULL,
    cbs integer DEFAULT 0 NOT NULL,
    li character varying(50),
    "or" character varying(50),
    disr character varying(50)
);


ALTER TABLE public.cnt OWNER TO postgres;

--
-- Name: csr; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.csr (
    ri character varying(200) NOT NULL,
    cst character varying(50),
    poa character varying(200),
    cb character varying(200),
    csi character varying(200),
    mei character varying(50),
    tri character varying(50),
    rr character varying(50),
    nl character varying(50),
    srv character varying(50)
);


ALTER TABLE public.csr OWNER TO postgres;

--
-- Name: grp; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grp (
    ri character varying(200) NOT NULL,
    mt character varying(50),
    cnm character varying(50),
    mnm character varying(50),
    mid text,
    macp text,
    mtv character varying(50),
    csy character varying(50),
    gn character varying(50)
);


ALTER TABLE public.grp OWNER TO postgres;

--
-- Name: hit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hit (
    ct character varying(15) NOT NULL,
    http integer DEFAULT 0,
    mqtt integer DEFAULT 0,
    coap integer DEFAULT 0,
    ws integer DEFAULT 0
);


ALTER TABLE public.hit OWNER TO postgres;

--
-- Name: lookup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lookup (
    ty integer NOT NULL,
    ct character(15) NOT NULL,
    et character(15) NOT NULL,
    lt character(15) NOT NULL,
    rn character varying(200) NOT NULL,
    st integer DEFAULT 0,
    lvl integer DEFAULT 0,
    ri character varying(200) NOT NULL,
    pi character varying(200) NOT NULL,
    loc json,
    acpi text NOT NULL,
    at text NOT NULL,
    aa text NOT NULL,
    subl text DEFAULT '[]'::text,
    pil text DEFAULT '[]'::text,
    lbl text DEFAULT '[]'::text,
    childs text DEFAULT '[]'::text,
    cr character varying(50),
    cs integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.lookup OWNER TO postgres;

--
-- Name: sub; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sub (
    ri character varying(200) NOT NULL,
    enc character varying(50),
    exc character varying(50),
    nu character varying(200) NOT NULL,
    gpi character varying(50),
    nfu character varying(50),
    bn character varying(50),
    rl character varying(50),
    psn character varying(50),
    pn character varying(50),
    nsp character varying(50),
    ln character varying(50),
    nct character varying(50),
    nec character varying(50),
    su character varying(50)
);


ALTER TABLE public.sub OWNER TO postgres;


--
-- Name: acp acp_ri_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acp
    ADD CONSTRAINT acp_ri_pkey PRIMARY KEY (ri);


--
-- Name: ae ae_aei_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ae
    ADD CONSTRAINT ae_aei_key UNIQUE (aei);


--
-- Name: ae ae_ri_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ae
    ADD CONSTRAINT ae_ri_key UNIQUE (ri);


--
-- Name: cb cb_csi_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cb
    ADD CONSTRAINT cb_csi_key UNIQUE (csi);


--
-- Name: cb cb_ri_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cb
    ADD CONSTRAINT cb_ri_key UNIQUE (ri);


--
-- Name: cin cin_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cin
    ADD CONSTRAINT cin_pkey PRIMARY KEY (ri);


--
-- Name: cin cin_ri_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cin
    ADD CONSTRAINT cin_ri_key UNIQUE (ri);


--
-- Name: cnt cnt_ri_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cnt
    ADD CONSTRAINT cnt_ri_key UNIQUE (ri);


--
-- Name: csr csr_ri_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.csr
    ADD CONSTRAINT csr_ri_pkey PRIMARY KEY (ri);


--
-- Name: grp grp_ri_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grp
    ADD CONSTRAINT grp_ri_pkey PRIMARY KEY (ri);


--
-- Name: hit hit_ct_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hit
    ADD CONSTRAINT hit_ct_key UNIQUE (ct);


--
-- Name: hit hit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hit
    ADD CONSTRAINT hit_pkey PRIMARY KEY (ct);


--
-- Name: lookup lookup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lookup
    ADD CONSTRAINT lookup_pkey PRIMARY KEY (ri, pi, ty);


--
-- Name: lookup lookup_ri_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lookup
    ADD CONSTRAINT lookup_ri_key UNIQUE (ri);


--
-- Name: sub sub_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sub
    ADD CONSTRAINT sub_pkey PRIMARY KEY (ri);


--
-- Name: sub sub_ri_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sub
    ADD CONSTRAINT sub_ri_unique UNIQUE (ri);


--
-- Name: ct_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ct_idx ON public.lookup USING btree (ct) WITH (deduplicate_items='true');


--
-- Name: fki_ae_ri; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_ae_ri ON public.ae USING btree (ri);


--
-- Name: fki_cb_ri_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_cb_ri_fkey ON public.cb USING btree (ri);


--
-- Name: fki_cnt_ri_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_cnt_ri_fkey ON public.cnt USING btree (ri);


--
-- Name: fki_f; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_f ON public.ae USING btree (ri);


--
-- Name: fki_grp_ri_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_grp_ri_fkey ON public.grp USING btree (ri);


--
-- Name: fki_lookup_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_lookup_fkey ON public.lookup USING btree (ri);


--
-- Name: fki_ri; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_ri ON public.lookup USING btree (ri);


--
-- Name: fki_ri_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_ri_fkey ON public.cb USING btree (ri);


--
-- Name: fki_sub_ri_fkey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fki_sub_ri_fkey ON public.sub USING btree (ri);


--
-- Name: acp acp_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acp
    ADD CONSTRAINT acp_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE;


--
-- Name: ae ae_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ae
    ADD CONSTRAINT ae_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- Name: cb cb_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cb
    ADD CONSTRAINT cb_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- Name: cin cin_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cin
    ADD CONSTRAINT cin_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- Name: cnt cnt_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cnt
    ADD CONSTRAINT cnt_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- Name: csr csr_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.csr
    ADD CONSTRAINT csr_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE;


--
-- Name: grp grp_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grp
    ADD CONSTRAINT grp_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- Name: sub sub_ri_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sub
    ADD CONSTRAINT sub_ri_fkey FOREIGN KEY (ri) REFERENCES public.lookup(ri) ON DELETE CASCADE NOT VALID;


--
-- PostgreSQL database dump complete
--

